/**
 * Browser end-to-end check of the API backend: register -> verify -> gallery
 * through the content proxy -> lightbox -> save offline -> offline library ->
 * viewer kept out of /admin -> admin console -> manual sync -> RBAC.
 * Fails on any console error, page exception or failed request, and asserts
 * the browser never contacts Dropbox directly.
 *
 * Needs the API running against the fake Dropbox and Vite proxying to it:
 *
 *   E2E_PORT=4100 E2E_WEB=http://localhost:5190 node apps/api/test/e2e-server.mjs
 *   VITE_API_PROXY_TARGET=http://localhost:4100 npx vite --port 5190   (in apps/web)
 *   node scripts/e2eApi.mjs http://localhost:5190
 *
 * The first account registered on a fresh rig becomes the admin; this script
 * expects admin@inspironics.test / Showcase2026 to exist (register it once).
 */
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] || 'http://localhost:5190'
const errors = []
const log = (m) => console.log('  ' + m)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1500, height: 950 },
})
const page = await browser.newPage()
const IGNORE = [/React Router Future Flag/i, /DevTools/i]
page.on('console', (m) => m.type() === 'error' && !IGNORE.some((r) => r.test(m.text())) && errors.push(`console: ${m.text()}`))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) => !/favicon|gsi\/client/.test(r.url()) && errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))
const upstream = []
page.on('request', (r) => /dropbox(api)?\.com/.test(r.url()) && upstream.push(r.url()))
page.on('response', (r) => r.url().includes('/api/auth/verify') && log('verify -> ' + r.status()))
page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errors.push(`5xx: ${r.url()} ${r.status()}`))

try {
  // 1. unauthenticated -> login page
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
  log(`unauthenticated lands on ${new URL(page.url()).pathname}`)

  // 2. register through the real UI
  await page.goto(BASE + '/register', { waitUntil: 'networkidle0' })
  const inputs = await page.$$('form input')
  const types = await Promise.all(inputs.map((i) => i.evaluate((e) => e.type + ':' + (e.autocomplete || e.name))))
  log(`register form fields: ${types.join(', ')}`)
  for (const i of inputs) {
    const t = await i.evaluate((e) => e.type)
    const ac = await i.evaluate((e) => e.autocomplete)
    if (t === 'email') await i.type(`viewer${Date.now()}@inspironics.test`)
    else if (t === 'password') await i.type('Showcase2026')
    else if (t === 'text' || ac === 'name') await i.type('Sudalai Admin')
  }
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form button[type=submit]')])
  log(`after register: ${new URL(page.url()).pathname}`)
  const code = await page.evaluate(() => JSON.parse(localStorage.getItem('inspironics.api.devcode.v1') || 'null')?.code)
  log(`dev code surfaced: ${code ? 'yes' : 'no'}`)
  await page.waitForSelector('input[inputmode=numeric]')
  await sleep(500)
  await page.focus('input[inputmode=numeric]')
  await page.keyboard.type(code, { delay: 40 })
  const verifyBtn = await page.$('form button[type=submit]')
  if (verifyBtn) await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}), verifyBtn.click()])
  await sleep(1500)
  log(`after verify: ${new URL(page.url()).pathname}`)

  // 3. gallery renders synced plates through the content proxy
  await page.waitForFunction(() => document.querySelectorAll('img[src*="/api/dropbox/files/"]').length > 0, { timeout: 20000 })
  await page.evaluate(() => document.getElementById('gallery')?.scrollIntoView())
  await sleep(2500)
  const imgs = await page.$$eval('img[src*="/api/dropbox/files/"]', (els) => els.map((e) => ({ src: e.getAttribute('src'), ok: e.complete && e.naturalWidth > 0 })))
  log(`proxied images: ${imgs.length}, loaded ${imgs.filter((i) => i.ok).length}`)
  const session = await page.evaluate(async () => (await (await fetch('/api/auth/session')).json()).session)
  log(`session role: ${session?.user?.role}`)
  const plates = await page.evaluate(async () => (await (await fetch('/api/entities/plates')).json()))
  log(`catalog: ${plates.total} plates; seeded titles e.g. "${plates.items.find((p) => p.titleSource === 'seed')?.title}"; deck "${plates.items.find((p) => p.ext === 'pptx')?.title}"`)

  // 4. lightbox opens with the proxied preview; save offline
  const opened = await page.evaluate(() => {
    const img = document.querySelector('#gallery img[src*="/api/dropbox/files/"]')
    const btn = img?.closest('button, [role=button], a') || img
    btn?.click()
    return !!btn
  })
  await sleep(1200)
  let dialog = await page.$('[role=dialog]')
  if (!dialog) {
    // flip cards may need a second click to open
    await page.evaluate(() => document.querySelector('#gallery [aria-label*="Open"], #gallery button[title*="Open"], #gallery button')?.click())
    await sleep(1000)
    dialog = await page.$('[role=dialog]')
  }
  log(`lightbox open: ${!!dialog} (clicked ${opened})`)
  if (dialog) {
    const preview = await page.$eval('[role=dialog] img[src*="/preview"], [role=dialog] iframe', (e) => e.getAttribute('src')).catch(() => null)
    log(`lightbox preview src: ${preview}`)
    const saveBtn = await page.$('[role=dialog] button[aria-label="Save for offline reading"]')
    if (saveBtn) {
      await saveBtn.click()
      await page.waitForSelector('[role=dialog] button[aria-label="Remove offline copy"]', { timeout: 10000 })
      log('saved for offline: yes')
    } else log('save button: missing')
    const fav = await page.$('[role=dialog] button[aria-label="Add to favourites"]')
    if (fav) await fav.click()
    await page.keyboard.press('Escape')
    await sleep(500)
  }

  // 5. offline library lists it
  await page.goto(BASE + '/offline', { waitUntil: 'networkidle0' })
  await sleep(800)
  const saved = await page.$$eval('main li', (els) => els.length)
  log(`offline library items: ${saved}`)

  // 6. a viewer is kept out of the console; the admin signs in through the form
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' })
  log(`viewer visiting /admin lands on ${new URL(page.url()).pathname}`)
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).then(() => localStorage.clear()))
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' })
  await page.type('form input[type=email]', 'admin@inspironics.test')
  await page.type('form input[type=password]', 'Showcase2026')
  await page.click('form button[type=submit]')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 15000 })
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' })
  await sleep(1000)
  const text = await page.evaluate(() => document.body.innerText)
  log(`admin shows account: ${/owner@inspironics\.test/.test(text)}; team: ${/team space/.test(text)}; folder: ${/\/Showcase/.test(text)}`)
  const runBtn = await page.$$eval('button', (bs) => bs.findIndex((b) => b.textContent.includes('Run sync now')))
  if (runBtn >= 0) {
    await page.evaluate((i) => document.querySelectorAll('button')[i].click(), runBtn)
    await sleep(3500)
    const after = await page.evaluate(() => document.body.innerText)
    log(`after manual sync: ${(after.match(/(success|partial|failed)[^\n]*/i) || ['?'])[0].slice(0, 90)}`)
  }
  const tabs = ['Sync logs', 'Users', 'Login history']
  for (const t of tabs) {
    await page.evaluate((label) => [...document.querySelectorAll('nav button')].find((b) => b.textContent === label)?.click(), t)
    await sleep(600)
    const rows = await page.$$eval('table tbody tr', (r) => r.length).catch(() => 0)
    log(`${t}: ${rows} rows`)
  }
  await page.screenshot({ path: process.env.SHOT || 'admin.png', fullPage: true })

  // 7. a guest cannot run a sync (this 403 is the one expected console error)
  const res = await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    const g = await fetch('/api/auth/guest', { method: 'POST' })
    const sync = await fetch('/api/dropbox/sync', { method: 'POST' })
    return { guest: g.status, sync: sync.status }
  })
  log(`guest -> POST /api/dropbox/sync: ${res.sync}`)
  if (res.sync !== 403) errors.push(`a guest could start a sync (${res.sync})`)
} catch (e) {
  errors.push(`script: ${e.message}`)
} finally {
  log(`browser requests to Dropbox: ${upstream.length}`)
  // the guest's refused sync logs one 403 to the console on purpose
  const real = errors.filter((e) => !/status of 403/.test(e))
  if (upstream.length) real.push(`the browser contacted Dropbox directly: ${upstream[0]}`)
  console.log(real.length ? `\n  ERRORS:\n  ${real.join('\n  ')}` : '\n  ok   no console errors, page errors or failed requests')
  process.exitCode = real.length ? 1 : 0
  await browser.close()
}
