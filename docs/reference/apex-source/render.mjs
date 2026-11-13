/**
 * Renders the Apex infographic (PNG) and product overview (PDF) from the HTML in this folder.
 *
 *   node "docs/reference/apex-source/render.mjs"
 *
 * Uses puppeteer-core from the Showcase workspace and the locally installed Chrome (or Edge).
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const out = path.resolve(here, '..')
const require = createRequire(path.join(root, 'inspironics-innovation-showcase/package.json'))
const puppeteer = require('puppeteer-core')

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p))

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()

  // Infographic: 1080 CSS px wide at 2x = 2160 px, full height (same width as the IVEOS reference).
  await page.setViewport({ width: 1080, height: 1200, deviceScaleFactor: 2 })
  await page.goto(pathToFileURL(path.join(here, 'APEX_Infographic.html')).href, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(out, 'APEX_Infographic.png'), fullPage: true })

  // Product overview PDF: A4 with page numbers in the footer.
  await page.goto(pathToFileURL(path.join(here, 'APEX_Product_Overview.html')).href, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.pdf({
    path: path.join(out, 'APEX_Product_Overview.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;text-align:center;font:8px Inter,Segoe UI,sans-serif;color:#8a98b0">' +
      'APEX — Product Overview · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  })
  console.log('Rendered APEX_Infographic.png and APEX_Product_Overview.pdf into', out)
} finally {
  await browser.close()
}
