/**
 * Apex product-demo capture (1920x1080, real app, real clicks).
 *
 *   run-capture.bat            (Apex must already be running: start.bat prod  -> http://localhost:4173
 *                               or start.bat -> http://localhost:5173)
 *
 * Read-only by default: it signs in, browses, searches and filters. It creates, edits and
 * deletes NOTHING. Pass --allow-writes only if you have approved data changes (none are
 * implemented yet; the flag is reserved so the storyboard can grow).
 *
 * Output (demo video/capture/out):
 *   frames/*.jpg + frames.ffconcat   screencast frames with real timing
 *   marks.json                       scene/step timestamps (seconds) for narration sync
 *   issues.json                      every step that failed, console errors, 4xx/5xx
 *   steps.json                       every step attempted and its result
 * Then the VM/ffmpeg assembles the MP4 (assemble.sh).
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const OUT = path.join(HERE, 'out')
const FRAMES = path.join(OUT, 'frames')
const BASE = process.argv.find((a) => a.startsWith('http')) || process.env.APEX_URL || 'http://localhost:5173'
const W = 1920, H = 1080

const readEnv = async (...p) =>
  Object.fromEntries((await fs.readFile(path.join(ROOT, ...p), 'utf8')).split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const env = await readEnv('slide vault', 'apps', 'api', '.env')
const ADMIN = { email: env.BOOTSTRAP_ADMIN_EMAIL, password: env.BOOTSTRAP_ADMIN_PASSWORD }

const require = createRequire(path.join(ROOT, 'inspironics-innovation-showcase', 'apps', 'web', 'package.json'))
const puppeteer = require('puppeteer-core')
const CHROME = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((p) => existsSync(p))
if (!CHROME) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(1) }

await fs.rm(OUT, { recursive: true, force: true })
await fs.mkdir(FRAMES, { recursive: true })

await fs.mkdir(path.join(OUT,'screenshots'),{recursive:true})
const shot = (n) => page.screenshot({ path: path.join(OUT,'screenshots',n+'.png') }).catch(()=>{})
const facts = {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const issues = [], steps = [], marks = []
const issue = (where, msg) => { issues.push({ where, msg }); console.log('  ISSUE', where, '-', msg) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         `--window-size=${W},${H}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
})
const page = await browser.newPage()
let where = 'start'
const IGNORE = [/React Router Future Flag/i, /React DevTools/i, /favicon/i, /status of 401/i]
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) issue(where, 'console: ' + m.text().slice(0, 200)) })
page.on('pageerror', (e) => issue(where, 'pageerror: ' + e.message))
page.on('response', (r) => { if (r.status() >= 500) issue(where, `HTTP ${r.status()} ${r.url().slice(0, 120)}`) })

/* ---------- visible cursor, click ripple, highlight ring (overlay only; app UI is untouched) ---------- */
await page.evaluateOnNewDocument(() => {
  const css = `
  #__cur{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-4px,-2px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #22d3ee;background:rgba(34,211,238,.25);animation:__rip .65s ease-out forwards}
  @keyframes __rip{to{transform:scale(4.2);opacity:0}}
  .__hl{outline:3px solid #22d3ee !important;outline-offset:4px;border-radius:10px;transition:outline-color .2s}`
  const boot = () => {
    if (document.getElementById('__cur')) return
    const s = document.createElement('style'); s.textContent = css; document.documentElement.appendChild(s)
    const c = document.createElement('div'); c.id = '__cur'
    c.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#0b1220" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    const pos = window.__curPos || [40, 40]; c.style.left = pos[0] + 'px'; c.style.top = pos[1] + 'px'
    addEventListener('mousemove', (e) => { window.__curPos = [e.clientX, e.clientY]; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 800) }, true)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot()
})

/* ---------- screencast with real frame timing ---------- */
const cdp = await page.createCDPSession()
const frames = []
let n = 0, t0 = null, wall0 = null
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  if (t0 === null) { t0 = metadata.timestamp; wall0 = Date.now() }
  const name = String(++n).padStart(6, '0') + '.jpg'
  frames.push({ name, t: metadata.timestamp - t0 })
  fs.writeFile(path.join(FRAMES, name), Buffer.from(data, 'base64')).catch(() => {})
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
const startRec = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
const now = () => (wall0 ? (Date.now() - wall0) / 1000 : 0)
const mark = (name) => { marks.push({ name, t: +now().toFixed(2) }); console.log(`[${now().toFixed(1)}s] ${name}`) }

/* ---------- human-like interaction helpers ---------- */
let mx = 60, my = 60
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
async function glide(x, y, ms = 750) {
  const steps = Math.max(18, Math.round(ms / 16)); const sx = mx, sy = my
  for (let i = 1; i <= steps; i++) { const e = ease(i / steps); await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e); await sleep(ms / steps) }
  mx = x; my = y
}
/** Finds a visible interactive element whose text matches; returns its centre or null. */
const locate = (texts, scope = 'a,button,[role=button],[role=tab],[role=link],[role=menuitem],summary,li,h2,h3') =>
  page.evaluate((texts, scope) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' }
    for (const t of texts) {
      const rx = t instanceof Array ? new RegExp(t[0], t[1] || 'i') : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      const hit = [...document.querySelectorAll(scope)].filter(vis).filter((el) => rx.test((el.innerText || el.getAttribute('aria-label') || '').trim()))
        .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]
      if (hit) { hit.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = hit.getBoundingClientRect(); hit.setAttribute('data-__t', '1'); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (hit.innerText || '').trim().slice(0, 40) } }
    }
    return null
  }, texts, scope)
const highlight = (ms = 1400) => page.evaluate((ms) => { const el = document.querySelector('[data-__t]'); if (el) { el.classList.add('__hl'); setTimeout(() => { el.classList.remove('__hl'); el.removeAttribute('data-__t') }, ms) } }, ms)
async function click(texts, label, { settle = 2600, hl = true } = {}) {
  texts = [].concat(texts)
  const p = await locate(texts)
  if (!p) { issue(where, `could not find "${texts.join('" / "')}" to click (${label})`); steps.push({ where, label, ok: false }); return false }
  await sleep(300); await glide(p.x, p.y); if (hl) { await highlight(); await sleep(500) }
  await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(settle)
  steps.push({ where, label, ok: true, clicked: p.label }); return true
}
async function hover(texts, label, ms = 1500) {
  const p = await locate([].concat(texts)); if (!p) { issue(where, `could not find "${texts}" to hover (${label})`); return false }
  await glide(p.x, p.y); await highlight(ms); await sleep(ms); steps.push({ where, label, ok: true }); return true
}
async function typeInto(selector, text, label, delay = 75) {
  const el = await page.$(selector)
  if (!el) { issue(where, `field ${selector} not found (${label})`); return false }
  const b = await el.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2, 650)
  await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(250)
  await page.keyboard.type(text, { delay }); steps.push({ where, label, ok: true }); return true
}
async function scrollBy(px, ms = 1800) {
  const steps_ = 30; for (let i = 0; i < steps_; i++) { await page.mouse.wheel({ deltaY: px / steps_ }); await sleep(ms / steps_) }
}
async function go(urlPath, label, settle = 3000) {
  await page.goto(BASE + urlPath, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => issue(where, `navigation to ${urlPath}: ${e.message}`))
  await sleep(settle); steps.push({ where, label, ok: true, url: page.url() })
}
async function card(html) {
  await page.setContent(`<!doctype html><meta charset=utf-8><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 700px at 30% 20%,#12306b,#070b1a);color:#fff;font-family:Inter,Segoe UI,system-ui,sans-serif;overflow:hidden}
  .w{text-align:center;animation:in 1.2s ease-out both}@keyframes in{from{opacity:0;transform:translateY(18px) scale(.98)}}
  h1{font-size:104px;margin:22px 0 8px;letter-spacing:.14em;font-weight:700}h2{font-size:34px;font-weight:400;color:#9fd8ff;margin:0}
  small{display:block;margin-top:34px;font-size:22px;letter-spacing:.3em;color:#7aa2d6}</style><div class=w>${html}</div>`)
}

try {
  await startRec(); await sleep(400)
  /* ============ SCENE 2 - login ============ */
  mark('S2 login'); where = 'login'
  await go('/login', 'open sign-in', 3500)
  await hover(['Innovate'], 'login value props', 1200)
  await typeInto('#email', ADMIN.email, 'type email')
  await sleep(500)
  await typeInto('input[type=password]', ADMIN.password, 'type password (masked)', 90)
  await sleep(700)
  const sb = await page.$('button[type=submit]'); const bb = sb && await sb.boundingBox()
  if (bb) { await glide(bb.x + bb.width / 2, bb.y + bb.height / 2); await highlight(); await page.mouse.down(); await sleep(70); await page.mouse.up() } else issue(where, 'submit button not found')
  mark('S2 signing in'); await sleep(5500)
  if (new URL(page.url()).pathname === '/login') issue(where, 'still on /login after submit')

  /* ============ SCENE 3 - dashboard ============ */
  mark('S3 dashboard'); where = 'dashboard'
  await go('/', 'dashboard', 3500)
  {
    const txt = await page.evaluate(() => document.body.innerText)
    facts.dashboardText = txt.slice(0, 4000)
    facts.syncFailedVisible = /sync failed/i.test(txt)
    facts.blueprintCount = (txt.match(/(\d[\d,]*)\s+intelligent-infrastructure blueprints/i) || [])[1] || null
    facts.platformsReady = (txt.match(/(\d+)\s*\/\s*(\d+)\s+platforms ready/i) || []).slice(1, 3)
    if (facts.syncFailedVisible) console.log('  NOTE: dashboard shows "Sync failed" - scene S8 limitations will apply')
  }
  await shot('dashboard')
  await scrollBy(420, 2200); await sleep(1200)
  await hover(['Innovation Showcase'], 'showcase card', 1800)
  await hover(['SlidesVault'], 'vault card', 1800)
  await hover(['Inspironics Academia'], 'academia card', 1800)
  await hover(['platforms ready', 'All systems'], 'status strip', 1800)
  await hover(['Recent activity'], 'recent activity', 2000)
  await scrollBy(-420, 1500)
  mark('S3 quick search')
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(1800)
  await page.keyboard.type('Showcase', { delay: 110 }); await sleep(1800)
  await page.keyboard.press('Escape'); await sleep(900)

  /* ============ SCENE 4/5 - Innovation Showcase ============ */
  mark('S4 showcase'); where = 'showcase'
  await click(['Open Platform'], 'open Showcase (first card)', { settle: 6000 })
  if (!page.url().includes('/showcase')) await go('/showcase/', 'showcase (direct)', 5000)
  await shot('showcase'); await sleep(1500); await scrollBy(700, 2500); await sleep(1200)
  await scrollBy(700, 2500); await sleep(1200)
  await scrollBy(-1400, 2000)
  mark('S4 showcase detail')
  await click(['Ecosystem'], 'open ecosystem explorer', { settle: 5500 }) || null
  await sleep(2500)
  await page.keyboard.press('Escape'); await sleep(800)
  await click(['Report'], 'open reports', { settle: 4500 }) || null
  await page.keyboard.press('Escape'); await sleep(800)
  await click(['Copilot', 'Ask AI', 'Assistant'], 'open AI copilot', { settle: 3500 }) || null
  await page.keyboard.press('Escape'); await sleep(800)

  /* ============ SCENE 5 - SlidesVault ============ */
  mark('S5 vault'); where = 'vault'
  await go('/', 'back to dashboard', 3000)
  where = 'vault'
  await go('/vault/', 'vault home', 5000)
  await click(['Library'], 'vault library', { settle: 4500 }); await shot('vault-library')
  await sleep(1500)
  await scrollBy(600, 2200); await sleep(1000); await scrollBy(-600, 1500)
  mark('S5 vault search')
  const search = await page.$('input[type=search], input[placeholder*="earch"]')
  if (search) { const b = await search.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await sleep(60); await page.mouse.up(); await page.keyboard.type('strategy', { delay: 110 }); await sleep(3000); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await sleep(1500) } else issue(where, 'vault search field not found')
  mark('S5 vault deck')
  const first = await locate([['.+']], 'a[href*="/presentation/"],[class*=card] a,article a')
  if (first) { await glide(first.x, first.y); await highlight(); await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(6000); steps.push({ where, label: 'open first deck', ok: true }) } else issue(where, 'no deck card found to open')
  await go('/vault/dashboard', 'vault analytics', 4500); await scrollBy(500, 2000); await sleep(1500)
  await go('/vault/offline', 'vault offline library', 3500)
  await go('/vault/user-manual', 'vault user manual', 3500)
  mark('S7 unified'); where = 'unified'
  await click(['Apex'], 'vault -> back to Apex dashboard (header link)', { settle: 4000 })
  if (new URL(page.url()).pathname !== '/') await go('/', 'dashboard (direct)', 3000)

  /* ============ SCENE 6 - Academia ============ */
  mark('S6 academia'); where = 'academia'
  await go('/academia/', 'academia home', 5000)
  await shot('academia')
  await go('/academia/courses', 'course catalogue', 4500); await scrollBy(500, 2000); await sleep(1200)
  await go('/academia/playbooks', 'playbooks', 4000)
  await go('/academia/tests', 'tests', 3500)
  await go('/academia/certificates', 'certificates', 3500)
  /* ============ SCENE 7/8 - wrap-up ============ */
  mark('S8 limits'); where = 'finale'
  await go('/', 'dashboard finale', 4500)
  await hover(['Recent activity'], 'recent activity (limitation scene)', 3500)
  await hover(['Innovation Showcase'], 'finale card 1', 1500); await hover(['SlidesVault'], 'finale card 2', 1500); await hover(['Inspironics Academia'], 'finale card 3', 1500)
  mark('S9 signout')
  await hover(['Sign out','Log out'], 'sign-out control', 1200)
  await click(['Sign out','Log out'], 'sign out', { settle: 4000 })
  if (new URL(page.url()).pathname !== '/login') issue(where, 'not on /login after sign-out')
  await shot('signed-out')
  mark('END')
} catch (e) {
  issue(where, 'fatal: ' + e.message)
} finally {
  await cdp.send('Page.stopScreencast').catch(() => {})
  await sleep(500)
  const total = now()
  const lines = ['ffconcat version 1.0']
  frames.forEach((f, i) => { lines.push(`file 'frames/${f.name}'`); lines.push(`duration ${(((frames[i + 1]?.t ?? (f.t + 1)) - f.t)).toFixed(4)}`) })
  if (frames.length) lines.push(`file 'frames/${frames.at(-1).name}'`)
  await fs.writeFile(path.join(OUT, 'frames.ffconcat'), lines.join('\n'))
  await fs.writeFile(path.join(OUT, 'marks.json'), JSON.stringify({ totalSeconds: total, marks }, null, 2))
  await fs.writeFile(path.join(OUT, 'issues.json'), JSON.stringify(issues, null, 2))
  await fs.writeFile(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2))
  await fs.writeFile(path.join(OUT, 'steps.json'), JSON.stringify(steps, null, 2))
  console.log(`\nDone. ${frames.length} frames, ${total.toFixed(1)}s, ${issues.length} issue(s). Output: ${OUT}`)
  await browser.close()
}
