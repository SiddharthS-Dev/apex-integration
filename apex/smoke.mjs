/**
 * Integration smoke test for Apex.
 *
 * Start Apex first (start.bat), then:  node apex/smoke.mjs [baseUrl]
 *
 * This checks the one thing neither project's own tests can: that the dashboard
 * hands off to each project through the gateway and the project actually boots
 * there — correct mount, assets resolving under the base path, router agreeing
 * with it, no console errors. It clicks the cards rather than visiting the URLs
 * directly, because clicking is what the dashboard is for.
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { GATEWAY_PORT } from './projects.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * The Apex sign-in is the apps' shared bootstrap administrator, so the smoke
 * test reads it from the same files the APIs do rather than hard-coding it.
 */
const readEnv = async (...parts) =>
  Object.fromEntries(
    (await readFile(path.join(ROOT, ...parts), 'utf8'))
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
  )
const VAULT_ENV = await readEnv('slide vault', 'apps', 'api', '.env')
const SHOWCASE_ENV = await readEnv('inspironics-innovation-showcase', 'apps', 'api', '.env')

/** The one Apex sign-in: the standard administrator both apps share. */
const ADMIN = { email: VAULT_ENV.BOOTSTRAP_ADMIN_EMAIL, password: VAULT_ENV.BOOTSTRAP_ADMIN_PASSWORD }
if (ADMIN.email !== SHOWCASE_ENV.BOOTSTRAP_ADMIN_EMAIL) {
  console.error('\n  The two apps have different BOOTSTRAP_ADMIN_EMAIL values; the single sign-in needs one account.\n')
  process.exit(1)
}

// Apex deliberately has no node_modules of its own, so it borrows the browser
// driver the Showcase already depends on.
const require = createRequire(path.join(ROOT, 'inspironics-innovation-showcase', 'apps', 'web', 'package.json'))
const puppeteer = require('puppeteer-core')

const BASE = process.argv[2] || `http://localhost:${GATEWAY_PORT}`
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const results = []
const errors = []
const ok = (m) => results.push(`  ok    ${m}`)
const fail = (m) => {
  results.push(`  FAIL  ${m}`)
  errors.push(m)
}

// Noise that says nothing about the integration.
const IGNORE = [
  /React Router Future Flag/i,
  /Download the React DevTools/i,
  /favicon/i,
  // Signed out, the vault asks the API who is signed in and the API answers
  // 401 — that is the answer, not a failure, but Chrome logs every 4xx fetch.
  /status of 401 \(Unauthorized\)/i,
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 950 },
})

const page = await browser.newPage()

/** Console/network problems are attributed to whichever page was open. */
let where = 'dashboard'
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) {
    fail(`[${where}] console: ${m.text()}`)
  }
})
page.on('pageerror', (e) => fail(`[${where}] pageerror: ${e.message}`))
// The vault's governing rule: the browser never talks to Dropbox. Every byte
// and every token goes through /vault/api, so any request to a Dropbox host
// from the page is a leak, whatever it was for.
page.on('request', (r) => {
  if (/(^|\.)dropbox(usercontent|api)?\.com$/i.test(new URL(r.url()).hostname)) {
    fail(`[${where}] the browser contacted Dropbox directly: ${r.url().slice(0, 120)}`)
  }
})
page.on('requestfailed', (r) => {
  if (!IGNORE.some((re) => re.test(r.url()))) {
    fail(`[${where}] request failed: ${r.url()} (${r.failure()?.errorText})`)
  }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** How much visible text the app has rendered into #root. */
const rendered = () =>
  page.evaluate(() => (document.querySelector('#root')?.innerText || '').trim().length)

try {
  /* -------------------------------------------------- the Apex sign-in */
  // Nothing is reachable before signing in: opening Apex lands on /login.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  new URL(page.url()).pathname === '/login'
    ? ok('opening Apex while signed out lands on /login')
    : fail(`signed out, / led to ${new URL(page.url()).pathname}`)

  const locked = await page.evaluate(async () => (await fetch('/vault/api/presentations')).status)
  locked === 401 ? ok('the APIs refuse requests before the Apex sign-in') : fail(`/vault/api answered ${locked} signed out`)

  // A wrong password is refused on the page, without leaving it.
  await page.type('#email', ADMIN.email)
  await page.type('#password', 'not-the-password')
  await page.click('#submit')
  await page
    .waitForFunction(() => document.getElementById('error').classList.contains('show'), { timeout: 15000 })
    .then(
      () => ok('a wrong password shows an error on the sign-in page'),
      () => fail('a wrong password showed no error')
    )

  // The real one, once, opens everything.
  await page.$eval('#password', (el) => (el.value = ''))
  await page.type('#password', ADMIN.password)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }), page.click('#submit')]).then(
    () => ok('signing in once through the Apex form succeeds'),
    () => fail('the Apex sign-in never navigated away')
  )

  /* ------------------------------------------------------------ dashboard */
  const title = await page.title()
  title.includes('Apex') ? ok(`dashboard serves "${title}"`) : fail(`dashboard title was "${title}"`)

  const who = await page
    .waitForFunction(() => !document.getElementById('account').hidden && document.getElementById('who').textContent, {
      timeout: 10000,
    })
    .then(
      (h) => h.jsonValue(),
      () => ''
    )
  who === ADMIN.email ? ok(`dashboard shows the signed-in account ${who}`) : fail(`dashboard account chip shows "${who}"`)

  const cards = await page.$$('[data-probe]')
  cards.length === 2 ? ok('dashboard shows both projects') : fail(`expected 2 cards, found ${cards.length}`)

  await page.waitForFunction(
    () => [...document.querySelectorAll('.status')].every((s) => s.dataset.state === 'up'),
    { timeout: 20000 }
  ).then(
    () => ok('both projects report Ready'),
    () => fail('a project never reported Ready on the dashboard')
  )

  /* ------------------ each app opens already signed in — no second login */
  for (const project of [
    { id: 'showcase', mount: '/showcase/', expect: /Showcase/i },
    { id: 'vault', mount: '/vault/', expect: /SlidesVault/i },
  ]) {
    where = project.id

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click(`a[data-probe="${project.mount}"]`),
    ])
    await sleep(2500)

    const at = new URL(page.url()).pathname
    at.startsWith(project.mount) && !at.endsWith('/login')
      ? ok(`${project.id} opens signed in at ${at}, no second login`)
      : fail(`${project.id} card ended on ${at}`)

    const t = await page.title()
    project.expect.test(t) ? ok(`${project.id} boots and titles itself "${t}"`) : fail(`${project.id} title was "${t}"`)

    const chars = await rendered()
    const hasForm = (await page.$('#root input[type="password"]')) !== null
    chars > 200 && !hasForm
      ? ok(`${project.id} renders its signed-in home (${chars} chars in #root)`)
      : fail(`${project.id} shows ${hasForm ? 'a sign-in form' : `almost nothing (${chars} chars)`}`)
  }

  /* ------------------------------------------ showcase: admin + Dropbox */
  where = 'showcase'
  await page.goto(`${BASE}/showcase/admin`, { waitUntil: 'networkidle2' })
  await sleep(2000)
  const showcaseAdmin = new URL(page.url()).pathname
  showcaseAdmin === '/showcase/admin'
    ? ok('showcase admin console opens for the standard admin')
    : fail(`showcase admin console bounced to ${showcaseAdmin}`)
  const showcaseCallback = `${BASE}/showcase/api/dropbox/oauth/callback`
  ;(await page.evaluate(() => document.body.innerText)).includes(showcaseCallback)
    ? ok(`showcase admin shows the redirect URI ${showcaseCallback}`)
    : fail(`showcase admin does not show ${showcaseCallback}`)

  /* ---------------------------------------------- vault: library + Dropbox */
  where = 'vault'
  await page.goto(`${BASE}/vault/`, { waitUntil: 'networkidle2' })
  await sleep(1500)
  const logoOk = await page.evaluate(() =>
    [...document.images].some((i) => i.src.includes('logo.svg') && i.naturalWidth > 0)
  )
  logoOk ? ok('vault logo loads from /vault/logo.svg') : fail('vault logo did not load')

  await page.goto(`${BASE}/vault/library`, { waitUntil: 'networkidle2' })
  await sleep(2500)
  const api = await page.evaluate(async () => {
    const r = await fetch('/vault/api/presentations?status=active&limit=1', { credentials: 'include' })
    return { status: r.status, total: r.ok ? (await r.json()).total : -1 }
  })
  api.status === 200
    ? ok(`vault API answers through the gateway (${api.total} active presentations)`)
    : fail(`GET /vault/api/presentations returned ${api.status}`)
  const shown = await page.evaluate(() => {
    const m = document.body.innerText.match(/([\d,]+)\s+presentations?/i)
    return m ? Number(m[1].replace(/,/g, '')) : -1
  })
  shown === api.total
    ? ok(`library reports ${shown} presentations, as the API does`)
    : fail(`library reports ${shown} presentations, the API says ${api.total}`)

  await page.goto(`${BASE}/vault/dropbox-settings`, { waitUntil: 'networkidle2' })
  await sleep(2000)
  const callback = `${BASE}/vault/api/dropbox/oauth/callback`
  ;(await page.evaluate(() => document.body.innerText)).includes(callback)
    ? ok(`dropbox settings shows the redirect URI ${callback}`)
    : fail(`dropbox settings does not show ${callback}`)

  /* ------------------------- signing out of one app signs out of Apex */
  // The vault's own sign-out, then a page inside it: the app finds no session
  // and hands the browser to the Apex sign-in, which ends every session — so
  // the Showcase is locked again too.
  await page.evaluate(async () => {
    await fetch('/vault/api/auth/logout', { method: 'POST', credentials: 'include' })
  })
  await page.goto(`${BASE}/vault/library`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).then(
    () => ok("an app's lapsed session hands over to the Apex sign-in"),
    () => fail(`after the vault signed out, ended on ${new URL(page.url()).pathname}`)
  )
  await page.goto(`${BASE}/showcase/`, { waitUntil: 'networkidle2' })
  new URL(page.url()).pathname === '/login'
    ? ok('...and the other app is signed out with it')
    : fail(`the Showcase stayed open at ${new URL(page.url()).pathname}`)

  /* ------------------------------------------- dashboard sign-out, too */
  where = 'dashboard'
  await page.waitForSelector('#password')
  await page.$eval('#email', (el) => (el.value = ''))
  await page.type('#email', ADMIN.email)
  await page.type('#password', ADMIN.password)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }), page.click('#submit')])
  const back = new URL(page.url()).pathname
  back === '/showcase/'
    ? ok('signing in again returns to the page that asked (/showcase/)')
    : fail(`signing in again landed on ${back}`)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('#account:not([hidden]) #signout', { visible: true, timeout: 10000 })
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#signout')])
  new URL(page.url()).pathname === '/login'
    ? ok('the dashboard Sign out returns to /login')
    : fail(`dashboard sign-out landed on ${new URL(page.url()).pathname}`)
  const after = await page.evaluate(async () => [
    (await fetch('/vault/api/auth/me')).status,
    (await fetch('/showcase/api/auth/session')).status,
  ])
  after.every((s) => s === 401)
    ? ok('after sign-out every API refuses again')
    : fail(`after sign-out the APIs answered ${after.join(', ')}`)

  where = 'dashboard'
} catch (err) {
  fail(`threw: ${err.message}`)
} finally {
  await browser.close()
}

console.log('')
console.log('  Apex integration smoke')
console.log(`  ${'-'.repeat(58)}`)
for (const line of results) console.log(line)
console.log('')

if (errors.length) {
  console.error(`  ${errors.length} problem(s).\n`)
  process.exit(1)
}
console.log('  All good.\n')
