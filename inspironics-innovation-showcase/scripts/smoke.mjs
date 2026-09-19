/**
 * Browser smoke test — drives the running dev server through the guest sign-in,
 * the 3D explorer, gallery filtering, the lightbox, the copilot and the report,
 * failing on any console error or page exception.
 *
 * Run with the dev server up:  node scripts/smoke.mjs [baseUrl]
 * Requires puppeteer-core and a local Chrome (npm i -D puppeteer-core).
 */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] || 'http://localhost:5173'

// The base URL may carry a mount path ('/showcase' behind the Apex gateway, and
// nothing at all standalone), so every in-app path is compared relative to it
// rather than assuming this app owns the site root.
const MOUNT = new URL(BASE).pathname.replace(/\/+$/, '')
const at = (p) => `${MOUNT}${p}`

// read the corpus size rather than restating it, so growing the dataset does
// not quietly turn this assertion into a lie
const EXPECTED_PLATES = JSON.parse(readFileSync('public/data/showcase.json', 'utf8')).items.length
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const errors = []
const steps = []
const ok = (m) => steps.push(`  ok   ${m}`)
const skip = (m) => steps.push(`  skip ${m}`)
const fail = (m) => {
  steps.push(`  FAIL ${m}`)
  errors.push(m)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
})

const page = await browser.newPage()
const IGNORE = [/React Router Future Flag/i, /Download the React DevTools/i]
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) => {
  if (!/favicon/.test(r.url())) errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`)
})

try {
  /* -------------------------------------------------------- auth gate ---- */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  if (!page.url().includes('/login')) fail(`protected route did not redirect (at ${page.url()})`)
  else ok('protected route redirects to /login')

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Continue as guest'))
    b.click()
  })
  await page.waitForFunction((home) => location.pathname === home, { timeout: 15000 }, at('/'))
  ok('guest sign-in lands on the showcase')

  /* ------------------------------------------------------------- hero ---- */
  await page.waitForSelector('#hero h1', { timeout: 20000 })
  const heroText = await page.$eval('#hero', (el) => el.innerText)
  if (!new RegExp(`\\b${EXPECTED_PLATES}\\b`).test(heroText)) {
    fail(`hero does not show the ${EXPECTED_PLATES}-plate count`)
  } else ok(`hero renders with dataset stats (${EXPECTED_PLATES} plates)`)

  /* ------------------------------------------------------------- 3D ------ */
  await page.waitForSelector('#ecosystem canvas', { timeout: 30000 })
  await sleep(3500)
  const canvasOk = await page.evaluate(() => {
    const c = document.querySelector('#ecosystem canvas')
    return !!c && c.width > 200 && c.height > 200 && !!c.getContext('webgl2')
  })
  if (!canvasOk) fail('3D canvas did not initialise')
  else ok('3D ecosystem canvas rendering')

  /* ---------------------------------------------------------- gallery ---- */
  await page.evaluate(() => document.getElementById('gallery').scrollIntoView())
  await page.waitForSelector('#gallery img', { timeout: 20000 })
  await sleep(1200)
  const cardCount = await page.$$eval('#gallery .flip-scene', (n) => n.length)
  if (cardCount < 40) fail(`gallery rendered only ${cardCount} cards`)
  else ok(`gallery rendered ${cardCount} cards`)

  const imgOk = await page.$$eval('#gallery img', (imgs) => imgs.filter((i) => i.naturalWidth > 0).length)
  if (imgOk < 5) fail(`only ${imgOk} gallery thumbnails actually loaded`)
  else ok(`${imgOk} thumbnails loaded from /images`)

  /* ---- search resolves an enrichment-only product token ------------------ */
  await page.type('#gallery input[type="search"]', 'kombos')
  await sleep(700)
  const kombos = await page.$eval('#gallery .sticky', (el) => el.innerText)
  const n = Number((kombos.match(/(\d+)\s+of\s+\d+/) || [])[1])
  if (n !== 64) fail(`"kombos" search returned ${n}, expected 64`)
  else ok('product enrichment resolves in search (kombos → 64)')

  /* ---- zone pill filters the gallery ------------------------------------ */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Clear all'))
    b?.click()
  })
  await sleep(400)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Smart Cities'))
    b.click()
  })
  await sleep(900)
  const banner = await page.$eval('#gallery', (el) => el.innerText)
  if (!/ecosystem filter/i.test(banner)) fail('ecosystem node route did not apply to the gallery')
  else ok('ecosystem node click filters the gallery')

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Release filter'))
    b?.click()
  })
  await sleep(500)

  /* ---- every zone pill must land on a populated gallery ----------------- */
  for (const zone of ['Smart Agri', 'Smart Energy', 'Residential', 'Hospitality']) {
    await page.evaluate((z) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(z))
      b.click()
    }, zone)
    await sleep(900)
    const bar = await page.$eval('#gallery .sticky', (el) => el.innerText)
    const shown = Number((bar.match(/(\d+)\s+of\s+\d+/) || [])[1])
    if (!shown) fail(`zone "${zone}" filters the gallery down to nothing`)
    else ok(`zone "${zone}" -> ${shown} plates`)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Release filter'))
      b?.click()
    })
    await sleep(400)
  }

  /* --------------------------------------------------------- lightbox ---- */
  await page.evaluate(() => document.querySelector('#gallery .flip-scene button').click())
  await sleep(900)
  const lb = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.className.includes('z-[90]'))
    return el ? el.innerText.slice(0, 200) : null
  })
  if (!lb || !/objective/i.test(lb)) fail('lightbox did not open with metadata')
  else ok('lightbox opens with metadata sidebar')
  await page.keyboard.press('Escape')
  await sleep(400)

  /* ---------------------------------------------------------- copilot ---- */
  await page.evaluate(() => document.querySelector('button[aria-label="Open copilot"]').click())
  await page.waitForSelector('input[placeholder="Ask about the estate…"]', { timeout: 10000 })
  await page.type('input[placeholder="Ask about the estate…"]', 'What is Caleido Kombos?')
  await page.keyboard.press('Enter')
  await sleep(2000)
  const chat = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder="Ask about the estate…"]')
    return inp.closest('div[class*="fixed"]').innerText
  })
  if (!/Caleido Kombos/.test(chat) || !/64/.test(chat)) fail('copilot did not answer the product question')
  else ok('copilot answers from the knowledge corpus')
  await page.evaluate(() => document.querySelector('button[aria-label="Close copilot"]').click())

  /* ----------------------------------------------------------- report ---- */
  await page.goto(`${BASE}/report`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('h1', { timeout: 20000 })
  const report = await page.$eval('body', (el) => el.innerText)
  if (!/monthly innovation report/i.test(report)) fail('report page did not render')
  else ok('report page renders')

  // This step reaches for the app's *source* modules, which only a dev server
  // exposes; a production build has hashed chunks and the SPA fallback answers
  // /src/... with index.html. Check first so serving a build reads as skipped
  // rather than as a broken PDF generator.
  const hasSources = await page.evaluate(async (mount) => {
    const res = await fetch(`${mount}/src/features/report/lib/reportPdf.js`)
    return res.ok && (res.headers.get('content-type') || '').includes('javascript')
  }, MOUNT)

  if (!hasSources) skip('PDF generation (needs the dev server — this is a production build)')
  else {
  // The module URLs carry the mount too: under the Apex gateway these are
  // served from /showcase/src/..., and a bare /src/... leaves the app entirely.
  const pdfPages = await page.evaluate(async (mount) => {
    const [{ loadShowcase }, { generateReportPdf }] = await Promise.all([
      import(`${mount}/src/features/showcase/model/showcaseData.js`),
      import(`${mount}/src/features/report/lib/reportPdf.js`),
    ])
    const data = await loadShowcase()
    const doc = generateReportPdf(data, { save: false })
    return doc.getNumberOfPages()
  }, MOUNT)
  if (!(pdfPages >= 3)) fail(`PDF generated only ${pdfPages} page(s)`)
  else ok(`PDF generated (${pdfPages} pages)`)
  }

  /* ------------------------------------------------------------ mobile -- */
  await page.setViewport({ width: 390, height: 844, isMobile: true })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('#gallery', { timeout: 30000 })
  await sleep(1500)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 2) fail(`page overflows horizontally by ${overflow}px at 390px wide`)
  else ok('no horizontal overflow at 390px')
} catch (e) {
  fail(`threw: ${e.message}`)
} finally {
  await browser.close()
}

console.log(steps.join('\n'))
if (errors.length) {
  console.log('\nFAILURES:\n' + errors.map((e) => `  - ${e}`).join('\n'))
  process.exit(1)
}
console.log('\nAll smoke checks passed.')
