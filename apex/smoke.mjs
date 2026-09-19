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

// Apex deliberately has no node_modules of its own, so it borrows the browser
// driver the Showcase already depends on.
const require = createRequire(path.join(ROOT, 'inspironics-innovation-showcase', 'package.json'))
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
  /* ------------------------------------------------------------ dashboard */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })

  const title = await page.title()
  title.includes('Apex') ? ok(`dashboard serves "${title}"`) : fail(`dashboard title was "${title}"`)

  const cards = await page.$$('[data-probe]')
  cards.length === 2 ? ok('dashboard shows both projects') : fail(`expected 2 cards, found ${cards.length}`)

  // The cards poll their mount; both should settle on "Ready".
  await page.waitForFunction(
    () => [...document.querySelectorAll('.status')].every((s) => s.dataset.state === 'up'),
    { timeout: 20000 }
  ).then(
    () => ok('both projects report Ready'),
    () => fail('a project never reported Ready on the dashboard')
  )

  /* ------------------------------------------- click through to each app */
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

    const url = new URL(page.url())
    url.pathname.startsWith(project.mount)
      ? ok(`clicking the card opens ${url.pathname}`)
      : fail(`card led to ${url.pathname}, expected ${project.mount}`)

    // Give the SPA a beat to mount and paint.
    await sleep(1800)

    const t = await page.title()
    project.expect.test(t) ? ok(`${project.id} boots and titles itself "${t}"`) : fail(`${project.id} title was "${t}"`)

    const chars = await rendered()
    chars > 200
      ? ok(`${project.id} renders (${chars} chars in #root)`)
      : fail(`${project.id} rendered almost nothing (${chars} chars) — check the base path`)

    // A router whose basename disagreed with the mount would bounce us out.
    const after = new URL(page.url())
    after.pathname.startsWith(project.mount)
      ? ok(`${project.id} router stays inside ${project.mount}`)
      : fail(`${project.id} navigated away to ${after.pathname}`)
  }

  /* ------------------------------------------------- sign in to the vault */
  // Past the login gate is where a wrong mount really shows: the router, the
  // lazy chunks and the logo all have to resolve under /vault/. (The Showcase
  // covers its own equivalent in scripts/smoke.mjs.)
  where = 'vault'
  await page.goto(`${BASE}/vault/login`, { waitUntil: 'networkidle2' })

  await page.type('input[type="email"]', 'avery.raman@inspironics.net')
  await page.type('input[type="password"]', 'slidesvault')
  await Promise.all([
    page.waitForFunction(() => !location.pathname.endsWith('/login'), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]).then(
    () => ok('vault sign-in succeeds behind the gateway'),
    () => fail('vault sign-in never left /vault/login')
  )

  await sleep(2000)
  const home = new URL(page.url())
  home.pathname.startsWith('/vault/')
    ? ok(`vault lands on ${home.pathname} after sign-in`)
    : fail(`vault sign-in left the mount, landing on ${home.pathname}`)

  // The brand logo is a public/ asset, the class of URL that silently 404s when
  // an app is mounted under a path it does not know about.
  const logoOk = await page.evaluate(() =>
    [...document.images].some((i) => i.src.includes('logo.svg') && i.naturalWidth > 0)
  )
  logoOk ? ok('vault logo loads from /vault/logo.svg') : fail('vault logo did not load')

  // Exercise a lazy route: its chunk must be fetched from under the mount.
  await page.goto(`${BASE}/vault/library`, { waitUntil: 'networkidle2' })
  await sleep(2500)
  const libChars = await rendered()
  libChars > 200
    ? ok(`vault library renders (${libChars} chars in #root)`)
    : fail(`vault library rendered almost nothing (${libChars} chars)`)

  /* ------------------------------------------- the catalog is the real one */
  // The local backend once seeded a 32-deck demo catalog while the real library
  // held 190, and nothing failed — the app just quietly showed the wrong number.
  // Pin the count to the committed snapshot so that cannot happen unnoticed.
  const catalog = JSON.parse(
    await readFile(path.join(ROOT, 'slide vault', 'src', 'api', 'catalog.json'), 'utf8')
  )
  const expected = catalog.filter((p) => p.status !== 'archived').length

  const seeded = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('slidesvault:Presentation')
      const rows = raw ? JSON.parse(raw) : []
      return rows.filter((r) => r.status !== 'archived').length
    } catch {
      return -1
    }
  })

  seeded === expected
    ? ok(`vault seeds the real catalog (${seeded} active presentations)`)
    : fail(`vault holds ${seeded} active presentations, expected ${expected} from catalog.json`)

  const shown = await page.evaluate(() => {
    const m = document.body.innerText.match(/([\d,]+)\s+presentations?/i)
    return m ? Number(m[1].replace(/,/g, '')) : -1
  })

  shown === expected
    ? ok(`library reports ${shown} presentations`)
    : fail(`library reports ${shown} presentations, expected ${expected}`)

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
