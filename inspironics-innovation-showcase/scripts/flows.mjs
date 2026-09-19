/**
 * End-to-end flow test — the journeys the smoke test does not cover: register ->
 * OTP -> verify, sign out and back in, forgot -> reset -> sign in, the 3D scene
 * surviving a route round-trip, ecosystem-filter release, adding a plate and
 * reloading, lightbox navigation, share deep links and the account menu.
 *
 * Fails on any console error, page exception or failed request.
 *
 * Run with the dev server up:  node scripts/flows.mjs
 * Requires puppeteer-core and a local Chrome (npm i -D puppeteer-core).
 */
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] || 'http://localhost:5173'

// The base URL may carry a mount path ('/showcase' behind the Apex gateway, and
// nothing at all standalone), so every in-app path is compared relative to it
// rather than assuming this app owns the site root.
const MOUNT = new URL(BASE).pathname.replace(/\/+$/, '')
const at = (p) => `${MOUNT}${p}`
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const found = []
const note = (m) => console.log('  ' + m)
const bug = (m) => {
  console.log('  BUG  ' + m)
  found.push(m)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1500, height: 950 },
})

const p = await browser.newPage()
const IGNORE = [/React Router Future Flag/i, /Download the React DevTools/i]
p.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) bug(`console: ${m.text().slice(0, 200)}`)
})
p.on('pageerror', (e) => bug(`pageerror: ${e.message.slice(0, 200)}`))
p.on('requestfailed', (r) => {
  if (!/favicon|gsi\/client/.test(r.url())) bug(`request failed: ${r.url().slice(0, 120)}`)
})

const clickText = (t) =>
  p.evaluate((tx) => {
    const b = [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim().includes(tx))
    if (!b) throw new Error(`no clickable element containing "${tx}"`)
    b.click()
  }, t)

const bodyText = () => p.evaluate(() => document.body.innerText)

try {
  /* ================================================= register -> OTP ==== */
  console.log('\n[register -> otp -> showcase]')
  await p.goto(`${BASE}/register`, { waitUntil: 'networkidle2' })
  const email = `tester${Date.now()}@inspironics.net`
  const fields = await p.$$('input')
  await fields[0].type('Test Person')
  await fields[1].type(email)
  await fields[2].type('Passw0rdy')
  await fields[3].type('Passw0rdy')
  await clickText('Create account')
  await p.waitForFunction((want) => location.pathname === want, { timeout: 10000 }, at('/verify'))
  await sleep(1200)
  const vtext = await bodyText()
  const code = (vtext.match(/your code is\s*(\d{6})/i) || [])[1]
  if (!code) bug('verify screen did not surface the dev OTP code')
  else {
    const boxes = await p.$$('input')
    for (let i = 0; i < 6; i++) await boxes[i].type(code[i])
    await clickText('Verify and continue')
    await p.waitForFunction((want) => location.pathname === want, { timeout: 15000 }, at('/'))
    note('register -> otp -> showcase ok')
  }
  await p.waitForSelector('#gallery .flip-scene', { timeout: 40000 })

  /* ============================================ sign out then sign in === */
  console.log('\n[sign out -> sign in]')
  await p.evaluate(() => {
    localStorage.removeItem('inspironics.auth.session.v1')
  })
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  const li = await p.$$('input')
  await li[0].type(email)
  await li[1].type('Passw0rdy')
  await clickText('Sign in')
  await p.waitForFunction((want) => location.pathname === want, { timeout: 15000 }, at('/'))
  note('sign in with registered credentials ok')

  /* ============================================== forgot / reset flow === */
  console.log('\n[forgot -> reset -> sign in]')
  await p.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle2' })
  await (await p.$('input')).type(email)
  await clickText('Send reset code')
  await sleep(1800)
  const ftext = await bodyText()
  const token = (ftext.match(/reset code is\s*(\d{6})/i) || [])[1]
  if (!token) bug('forgot-password did not surface the dev reset code')
  else {
    await clickText('Enter reset code')
    await p.waitForFunction((want) => location.pathname === want, { timeout: 10000 }, at('/reset-password'))
    await sleep(1200)
    const ri = await p.$$('input')
    await ri[1].type(token)
    await ri[2].type('NewPassw0rd')
    await ri[3].type('NewPassw0rd')
    await clickText('Update password')
    await sleep(1400)
    if (!/password updated/i.test(await bodyText())) bug('reset password did not confirm')
    else {
      await clickText('Sign in')
      await p.waitForFunction((want) => location.pathname === want, { timeout: 10000 }, at('/login'))
      await sleep(1200)
      const l2 = await p.$$('input')
      await l2[0].type(email)
      await l2[1].type('NewPassw0rd')
      await clickText('Sign in')
      await p.waitForFunction((want) => location.pathname === want, { timeout: 15000 }, at('/'))
      note('forgot -> reset -> sign in with new password ok')
    }
  }

  await p.waitForSelector('#gallery .flip-scene', { timeout: 40000 })
  await sleep(2500)

  /* ================================== 3D survives a route round-trip ==== */
  console.log('\n[3D scene after navigating away and back]')
  const labelCount = () =>
    p.evaluate(() => {
      const c = document.querySelector('#ecosystem canvas')
      if (!c) return -1
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      return gl ? (gl.isContextLost() ? -2 : 1) : -3
    })
  await p.evaluate(() => document.getElementById('ecosystem').scrollIntoView())
  await sleep(2500)
  const before = await p.screenshot({ encoding: 'base64', clip: { x: 60, y: 300, width: 1300, height: 600 } })
  await p.goto(`${BASE}/report`, { waitUntil: 'networkidle2' })
  await sleep(1500)
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  await p.waitForSelector('#ecosystem canvas', { timeout: 40000 })
  await p.evaluate(() => document.getElementById('ecosystem').scrollIntoView())
  await sleep(4500)
  const ctx = await labelCount()
  if (ctx < 0) bug(`3D context unhealthy after route round-trip (code ${ctx})`)
  const after = await p.screenshot({ encoding: 'base64', clip: { x: 60, y: 300, width: 1300, height: 600 } })
  // A totally black frame after the round-trip means the scene failed to rebuild.
  const brightness = await p.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = 120
    cv.height = 60
    const c2 = cv.getContext('2d')
    c2.drawImage(img, 0, 0, 120, 60)
    const d = c2.getImageData(0, 0, 120, 60).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]
    return Math.round(s / (d.length / 4) / 3)
  }, after)
  note(`scene mean brightness after round-trip: ${brightness}`)
  if (brightness < 12) bug('3D scene renders nearly black after navigating away and back')

  /* ========================================= stale ecosystem-filter tag = */
  console.log('\n[ecosystem filter banner vs manual filter change]')
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Smart Cities'))
    b.click()
  })
  await sleep(1500)
  await p.select('#gallery select', 'Value Frameworks')
  await sleep(900)
  const g = await p.$eval('#gallery', (e) => e.innerText)
  if (/ecosystem filter/i.test(g) && /Smart Cities/.test(g)) {
    bug('gallery still shows the "Ecosystem filter · Smart Cities" banner after the category was changed by hand')
  } else note('banner clears on manual filter change')
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Clear all'))
    b?.click()
  })
  await sleep(800)

  /* ============================================= add a custom plate ===== */
  console.log('\n[add image -> persists across reload]')
  await clickText('Add Image')
  await sleep(1200)
  await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')]
    const title = inputs.find((i) => i.placeholder === 'Edge Inference Mesh')
    const url = inputs.find((i) => i.placeholder === 'https://…')
    const set = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      s.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(title, 'Bug Hunt Plate')
    set(
      url,
      'data:image/svg+xml;base64,' +
        btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#0ff"/></svg>')
    )
  })
  await sleep(400)
  await clickText('Add to gallery')
  await sleep(1500)
  let gal = await p.$eval('#gallery', (e) => e.innerText)
  if (!/Bug Hunt Plate/.test(gal)) bug('custom plate did not appear in the gallery after adding')
  else note('custom plate appears')
  const total = Number((gal.match(/(\d+)\s+of\s+(\d+)/) || [])[2])
  if (total !== 236) bug(`gallery total is ${total} after adding a plate, expected 236`)
  else note('gallery total incremented to 236')

  await p.reload({ waitUntil: 'networkidle2' })
  await p.waitForSelector('#gallery .flip-scene', { timeout: 40000 })
  await sleep(2000)
  gal = await p.$eval('#gallery', (e) => e.innerText)
  if (!/Bug Hunt Plate/.test(gal)) bug('custom plate did not survive a reload')
  else note('custom plate survives reload')

  /* ================================================ lightbox next/prev == */
  console.log('\n[lightbox navigation]')
  await p.evaluate(() => document.querySelector('#gallery .flip-scene button').click())
  await sleep(1500)
  const t1 = await p.evaluate(() => document.querySelector('.z-\\[90\\] h3')?.innerText)
  await p.keyboard.press('ArrowRight')
  await sleep(1200)
  const t2 = await p.evaluate(() => document.querySelector('.z-\\[90\\] h3')?.innerText)
  if (!t1 || !t2 || t1 === t2) bug(`lightbox arrow-right did not advance (${t1} -> ${t2})`)
  else note(`lightbox advances: ${t1} -> ${t2}`)
  await p.keyboard.press('ArrowLeft')
  await sleep(1000)
  const t3 = await p.evaluate(() => document.querySelector('.z-\\[90\\] h3')?.innerText)
  if (t3 !== t1) bug(`lightbox arrow-left did not go back (${t3} != ${t1})`)
  else note('lightbox goes back')
  await p.keyboard.press('Escape')
  await sleep(800)
  const scrollLocked = await p.evaluate(() => getComputedStyle(document.body).overflow)
  if (scrollLocked === 'hidden') bug('body scroll stayed locked after closing the lightbox')
  else note('body scroll restored after close')

  /* ================================================ share deep link ===== */
  console.log('\n[share link opens the plate]')
  await p.goto(`${BASE}/#IMG_0559.jpg`, { waitUntil: 'networkidle2' })
  await p.waitForSelector('#gallery .flip-scene', { timeout: 40000 })
  await sleep(2500)
  const deep = await p.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => String(d.className).includes('z-[90]'))
    return el ? el.innerText.slice(0, 120) : null
  })
  if (!deep || !/operating system/i.test(deep)) bug(`share deep link did not open the plate (got: ${deep})`)
  else note('share deep link opens the right plate')
  await p.keyboard.press('Escape')
  await sleep(700)
  if (await p.evaluate(() => !!location.hash)) bug('hash not cleared after closing a deep-linked plate')
  else note('hash cleared on close')

  /* =============================================== account menu a11y ==== */
  console.log('\n[account menu]')
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-haspopup') === 'menu')
    if (!b) throw new Error('no account menu trigger')
    b.click()
  })
  await sleep(600)
  if (!(await p.$('[role="menu"]'))) bug('account menu did not open on click')
  else note('account menu opens on click')
  await p.keyboard.press('Escape')
  await sleep(500)
  if (await p.$('[role="menu"]')) bug('account menu did not close on Escape')
  else note('account menu closes on Escape')

  /* ==================================================== mobile menu ===== */
  console.log('\n[mobile nav]')
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  await p.waitForSelector('button[aria-label="Open menu"]', { timeout: 30000 })
  await p.click('button[aria-label="Open menu"]')
  await sleep(900)
  if (!/Ecosystem[\s\S]*Contact/.test(await bodyText())) bug('mobile menu did not open')
  else note('mobile menu opens')
  await p.click('button[aria-label="Close menu"]')
  await sleep(900)
  const mobLocked = await p.evaluate(() => getComputedStyle(document.body).overflow)
  if (mobLocked === 'hidden') bug('body scroll stayed locked after closing the mobile menu')
  else note('mobile menu closes and restores scroll')
} catch (e) {
  bug(`threw: ${e.message}`)
} finally {
  await browser.close()
}

console.log(`\n${found.length} issue(s) found.`)
process.exit(found.length ? 1 : 0)
