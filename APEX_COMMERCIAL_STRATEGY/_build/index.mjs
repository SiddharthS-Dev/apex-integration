// Builds APEX_Commercial_Infographics_Index.pdf (A4) and the offline gallery / Persona Explorer.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as K from './content.mjs'
import { POSTERS } from './posters.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const PREV = path.join(import.meta.dirname, 'previews')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pad = (n) => String(n).padStart(2, '0')
const LOGO = '<svg viewBox="0 0 32 32" fill="none"><defs><linearGradient id="lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00f0ff"/><stop offset="1" stop-color="#c065f0"/></linearGradient></defs><path d="M16 2.5 29 27H3L16 2.5Z" stroke="url(#lg)" stroke-width="2.1" stroke-linejoin="round"/><path d="M16 12.5 22 24H10l6-11.5Z" fill="url(#lg)" opacity=".85"/></svg>'

// ---------------------------------------------------------------- gallery ----
const GAL = path.join(ROOT, 'gallery')
fs.mkdirSync(path.join(GAL, 'previews'), { recursive: true })
for (const p of POSTERS) fs.copyFileSync(path.join(PREV, `${pad(p.n)}.png`), path.join(GAL, 'previews', `${pad(p.n)}.png`))
fs.writeFileSync(path.join(GAL, 'logo.svg'), LOGO)
const DATA = { personas: K.PERSONAS, posters: POSTERS.map(({ build, ...p }) => p), materials: K.MATERIALS, funnel: K.FUNNEL, journey: K.JOURNEY, segments: K.SEGMENTS, positioning: K.POSITIONING, product: K.PRODUCT, demos: K.DEMOS, readiness: K.META.readiness }
const SUGGEST = { A: [1, 9], B: [4, 7], C: [5, 11], D: [9, 12], E: [8, 11], F: [10, 2] }
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>APEX Commercial Strategy</title>
<link rel="icon" href="logo.svg">
<style>
:root{--bg:#F7F9FC;--card:#fff;--ink:#0F172A;--ink2:#334155;--muted:#64748B;--line:#E2E8F0;--brand:#06B6D4;--brand2:#7C3AED;--hdr:#0B1736}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0B1020;--card:#121a30;--ink:#E2E8F0;--ink2:#CBD5E1;--muted:#94A3B8;--line:#24304d}}
:root[data-theme=dark]{--bg:#0B1020;--card:#121a30;--ink:#E2E8F0;--ink2:#CBD5E1;--muted:#94A3B8;--line:#24304d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 'Segoe UI',system-ui,Arial,sans-serif}
header{background:linear-gradient(135deg,#0B1736,#13224A 60%,#2A1A5E);color:#fff;padding:28px 16px 0}
.wrap{max-width:1200px;margin:0 auto}
.brand{display:flex;gap:12px;align-items:center;font-weight:800;letter-spacing:.12em;font-size:14px}.brand svg{width:34px;height:34px}
h1{font-size:clamp(26px,4vw,40px);margin:14px 0 6px}header p{color:#CBD5E1;max-width:820px;margin:0 0 18px}
nav{display:flex;gap:4px;overflow-x:auto;border-top:1px solid rgba(255,255,255,.12)}
nav button{background:none;border:0;color:#CBD5E1;padding:12px 14px;font:600 14px 'Segoe UI',Arial;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap}
nav button[aria-selected=true]{color:#fff;border-color:var(--brand)}
main{padding:24px 16px 48px}section[hidden]{display:none}
.note{font-size:13px;color:var(--muted);border-left:3px solid var(--brand2);padding:8px 12px;background:var(--card);border-radius:6px;margin:0 0 20px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.card h3{margin:0 0 6px;font-size:17px}.tag{display:inline-block;font:700 11px 'Segoe UI';letter-spacing:.08em;padding:3px 8px;border-radius:4px;color:#fff}
.poster img{width:100%;border-radius:6px;border:1px solid var(--line);display:block;aspect-ratio:1/1.4142;object-fit:cover;background:#fff}
.poster a{color:var(--brand);font-weight:600;text-decoration:none;margin-right:12px}
.pick{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.pick button{border:2px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:8px 12px;font:600 14px 'Segoe UI';cursor:pointer}
.pick button[aria-pressed=true]{border-color:currentColor}
dl{display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:8px 16px;margin:0}dt{font-weight:700;color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.05em}dd{margin:0;color:var(--ink2)}
@media (max-width:640px){dl{grid-template-columns:1fr}dt{margin-top:8px}}
table{border-collapse:collapse;width:100%;font-size:14px;background:var(--card)}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
.dot{font-size:18px;text-align:center}
</style></head>
<body>
<header><div class="wrap">
<div class="brand">${LOGO}<span>INSPIRONICS APEX · COMMERCIAL STRATEGY</span></div>
<h1>Taking APEX to market</h1>
<p>Positioning, segments, personas, education, funnel and the 12 A0 posters, in one offline page. It is separate from the APEX application.</p>
<nav role="tablist"></nav></div></header>
<main class="wrap">
<p class="note"></p>
<section id="overview"></section><section id="segments" hidden></section><section id="explorer" hidden></section><section id="materials" hidden></section><section id="funnel" hidden></section><section id="journey" hidden></section><section id="gallery" hidden></section>
</main>
<script>
const D=${JSON.stringify(DATA)};
const SUGGEST=${JSON.stringify(SUGGEST)};
const COL={navy:'#0B1736',blue:'#2563EB',teal:'#0D9488',violet:'#7C3AED',green:'#059669',amber:'#D97706'};
const el=(t,a={},...k)=>{const e=document.createElement(t);for(const[n,v]of Object.entries(a)){if(n==='style')e.style.cssText=v;else if(n.startsWith('on'))e.addEventListener(n.slice(2),v);else e.setAttribute(n,v)}for(const c of k.flat())if(c!=null)e.append(c.nodeType?c:document.createTextNode(c));return e};
const pad=n=>String(n).padStart(2,'0');
const tabs=[['overview','Commercial overview'],['segments','Customer segments'],['explorer','Persona explorer'],['materials','Educational materials'],['funnel','Sales funnel'],['journey','Customer journey'],['gallery','Infographic gallery']];
const nav=document.querySelector('nav');
function show(id){for(const[t]of tabs){document.getElementById(t).hidden=t!==id}for(const b of nav.children)b.setAttribute('aria-selected',b.dataset.id===id);try{sessionStorage.setItem('tab',id)}catch(e){}}
for(const[id,l]of tabs)nav.append(el('button',{role:'tab','data-id':id,onclick:()=>show(id)},l));
document.querySelector('.note').textContent=D.readiness;
const card=(h,...k)=>el('div',{class:'card'},el('h3',{},h),...k);
const ul=a=>el('ul',{},a.map(x=>el('li',{},x)));
// overview
document.getElementById('overview').append(
 card('Positioning statement',el('p',{},D.positioning.statement)),el('br'),
 el('div',{class:'grid'},card('What we sell',el('p',{},D.positioning.selling)),card('Who buys',el('p',{},D.positioning.whoBuys)),card('Why they buy',ul(D.positioning.whyBuy))),el('br'),
 el('div',{class:'grid'},D.product.modules.map(m=>card(m.name,el('span',{class:'tag',style:'background:#059669'},m.maturity),el('p',{},m.what)))),el('br'),
 el('div',{class:'grid'},card('Differentiators (today)',ul(D.product.differentiators)),card('Roadmap (not yet live)',ul(D.product.roadmap)),card('Pricing framework — no prices set',ul(D.positioning.pricingModels.map(m=>m.model+': '+m.fit)))))
// segments
document.getElementById('segments').append(el('div',{class:'grid'},D.segments.industries.map(s=>card(s.name,el('span',{class:'tag',style:'background:'+(s.priority==='Primary'?'#06B6D4':s.priority==='Secondary'?'#7C3AED':'#475569')},s.priority.toUpperCase()),el('p',{},s.why)))),el('br'),
 el('div',{class:'grid'},D.segments.orgTypes.map(o=>card(o.name,el('p',{},o.note)))),el('br'),card('Commercial opportunities',ul(D.segments.opportunities),el('p',{style:'color:var(--muted)'},D.segments.note)))
// explorer
const ex=document.getElementById('explorer');const pick=el('div',{class:'pick'});const out=el('div');ex.append(pick,out);
function persona(id){const p=D.personas.find(x=>x.id===id);for(const b of pick.children)b.setAttribute('aria-pressed',b.dataset.id===id);
 const sug=SUGGEST[id].map(n=>D.posters.find(x=>x.n===n));
 out.replaceChildren(el('div',{class:'card',style:'border-top:6px solid '+COL[p.color]},
  el('h3',{},'Persona '+p.id+' — '+p.name),el('p',{style:'color:var(--muted)'},p.titles.join(' · ')),
  el('dl',{},
   el('dt',{},'Buying role'),el('dd',{},p.role+' — '+p.authority+' (influence: '+p.influence+')'),
   el('dt',{},'Business challenges'),el('dd',{},ul(p.challenges)),
   el('dt',{},'Pain points'),el('dd',{},ul(p.pains)),
   el('dt',{},'Expects from APEX'),el('dd',{},p.expectsFromApex),
   el('dt',{},'APEX value proposition'),el('dd',{},p.value),
   el('dt',{},'Recommended sales pitch'),el('dd',{},'“'+p.message+'”'),
   el('dt',{},'Relevant features'),el('dd',{},ul(p.features)),
   el('dt',{},'Objections & responses'),el('dd',{},ul(p.objections.map(o=>o.q+' → '+o.a))),
   el('dt',{},'Educational content'),el('dd',{},ul(p.materials)),
   el('dt',{},'What to teach'),el('dd',{},p.teach.teach+' Problem: '+p.teach.problem+' Show: '+p.teach.capability),
   el('dt',{},'Suggested infographics'),el('dd',{},sug.map(s=>el('div',{},el('a',{href:'../'+s.dir+'/'+s.file+'.png'},'Poster '+pad(s.n)+' — '+s.title)))),
   el('dt',{},'Channels & CTA'),el('dd',{},p.channels.join(' · ')+' → '+p.cta),
   el('dt',{},'Conversion strategy'),el('dd',{},p.conversion))))}
for(const p of D.personas)pick.append(el('button',{'data-id':p.id,style:'color:'+COL[p.color],onclick:()=>persona(p.id)},p.id+' · '+p.short));
persona('A');
// materials
const mk=v=>v===2?'●':v===1?'○':'';
document.getElementById('materials').append(el('p',{},'● primary · ○ supporting'),el('div',{class:'scroll'},el('table',{},el('thead',{},el('tr',{},el('th',{},'Material'),el('th',{},'Purpose'),D.personas.map(p=>el('th',{style:'color:'+COL[p.color]},p.id)))),el('tbody',{},D.materials.map(m=>el('tr',{},el('td',{},m.name),el('td',{},m.purpose),D.personas.map(p=>el('td',{class:'dot',style:'color:'+COL[p.color]},mk(m.personas[p.id]||0)))))))))
// funnel
document.getElementById('funnel').append(el('div',{class:'scroll'},el('table',{},el('thead',{},el('tr',{},['#','Stage','Objective','Customer expects','Material','Activity','Outcome','Metric'].map(h=>el('th',{},h)))),el('tbody',{},D.funnel.map((s,i)=>el('tr',{},[i+1,s.stage,s.objective,s.expectation,s.material,s.activity,s.outcome,s.metric].map(v=>el('td',{},String(v)))))))))
// journey
document.getElementById('journey').append(el('div',{class:'grid'},D.journey.map((j,i)=>card((i+1)+'. '+j.phase,el('p',{},j.touch),el('p',{style:'color:var(--muted)'},'Feels: '+j.feel),el('p',{},'We: '+j.our)))))
// gallery
document.getElementById('gallery').append(el('div',{class:'grid'},D.posters.map(p=>el('div',{class:'card poster'},el('a',{href:'../'+p.dir+'/'+p.file+'.png'},el('img',{src:'previews/'+pad(p.n)+'.png',alt:'Poster '+pad(p.n)+': '+p.title,loading:'lazy'})),el('h3',{style:'margin-top:10px'},pad(p.n)+' · '+p.title),el('a',{href:'../'+p.dir+'/'+p.file+'.png'},'PNG 9933×14043'),el('a',{href:'../'+p.dir+'/'+p.file+'.pdf'},'PDF A0'),el('a',{href:'../'+p.dir+'/source.svg'},'SVG')))))
let t='overview';try{t=sessionStorage.getItem('tab')||t}catch(e){}show(tabs.some(x=>x[0]===t)?t:'overview');
</script></body></html>`
fs.writeFileSync(path.join(GAL, 'index.html'), html)
console.log('wrote gallery/index.html')

// ---------------------------------------------------------------- index PDF (A4) ----
const img = (n) => 'data:image/png;base64,' + fs.readFileSync(path.join(PREV, `${pad(n)}.png`)).toString('base64')
const pages = []
pages.push(`<section class="cover"><div class="logo">${LOGO}</div><div class="kick">INSPIRONICS APEX</div><h1>Commercial Strategy<br>A0 Infographic Series</h1><p>Twelve A0 posters (841 × 1189 mm) that explain how APEX is positioned, who buys it, how each persona is educated and how prospects become paying clients.</p><p class="small">${esc(K.META.edition)}. Internal sales enablement.</p><p class="small">${esc(K.META.readiness)}</p></section>`)
pages.push(`<section><h2>Contents</h2><table><thead><tr><th>#</th><th>Poster</th><th>Folder</th><th>Files</th></tr></thead><tbody>${POSTERS.map((p) => `<tr><td>${pad(p.n)}</td><td>${esc(p.title)}</td><td>${p.dir}/</td><td>${p.file}.png<br>${p.file}.pdf<br>source.svg</td></tr>`).join('')}</tbody></table>
<h3>Specifications</h3><ul><li>PNG: 9933 × 14043 px, RGB, 300 DPI, rendered directly from the vector source (not upscaled).</li><li>PDF: one page, 841 × 1189 mm (A0 portrait), vector, RGB.</li><li>SVG: editable vector source, A0 in millimetres.</li><li>For offset printing, the print shop converts the RGB PDF to its CMYK profile.</li></ul></section>`)
for (const p of POSTERS) pages.push(`<section class="pp"><div class="ph"><span>POSTER ${pad(p.n)} / 12</span><h2>${esc(p.title)}</h2><p class="small">${p.dir}/${p.file}.png · .pdf · source.svg</p></div><img src="${img(p.n)}" alt=""></section>`)
const indexHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:14mm}body{font-family:'Segoe UI',Arial,sans-serif;color:#0F172A;margin:0}
section{page-break-after:always;break-after:page}section:last-child{page-break-after:auto}
.cover{height:250mm;background:linear-gradient(135deg,#0B1736,#13224A 60%,#2A1A5E);color:#fff;padding:24mm 16mm;box-sizing:border-box;border-radius:4mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover .logo svg{width:28mm;height:28mm}.kick{letter-spacing:.2em;font-weight:800;color:#5EEAD4;margin-top:10mm}.cover h1{font-size:30pt;line-height:1.15;margin:6mm 0}.cover p{font-size:12pt;color:#CBD5E1;max-width:150mm}.small{font-size:9pt!important;color:#64748B}.cover .small{color:#94A3B8!important}
h2{font-size:18pt;margin:0 0 4mm}table{border-collapse:collapse;width:100%;font-size:8.5pt}th,td{border-bottom:.3mm solid #E2E8F0;padding:1.4mm 2mm;text-align:left;vertical-align:top}th{color:#64748B;font-size:8pt;text-transform:uppercase}
.pp{text-align:center}.ph{text-align:left;margin-bottom:3mm}.ph span{font-size:8pt;font-weight:800;letter-spacing:.15em;color:#06B6D4}.ph h2{margin:1mm 0}
.pp img{height:215mm;width:auto;border:.3mm solid #E2E8F0}
</style></head><body>${pages.join('')}</body></html>`
const puppeteer = require('E:/apex/inspironics-innovation-showcase/node_modules/puppeteer-core')
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'E:/apex-review-tmp/chrome-index', args: ['--no-sandbox', '--disable-gpu'] })
const page = await b.newPage()
await page.setContent(indexHtml, { waitUntil: 'load' })
await page.pdf({ path: path.join(ROOT, 'APEX_Commercial_Infographics_Index.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await b.close()
console.log('wrote APEX_Commercial_Infographics_Index.pdf')
