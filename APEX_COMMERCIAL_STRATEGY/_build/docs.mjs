// Generates the commercial strategy documents from content.mjs, so the documents and posters never disagree.
import fs from 'node:fs'
import path from 'node:path'
import * as K from './content.mjs'
import { POSTERS } from './posters.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'docs')
fs.mkdirSync(OUT, { recursive: true })
const md = (rows, head) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`)].join('\n')
const list = (a) => a.map((x) => `- ${x}`).join('\n')
const P = K.PERSONAS
const STAMP = `_${K.META.product} · ${K.META.edition}. Internal sales enablement._\n\n> ${K.META.readiness}\n`
const write = (f, s) => { fs.writeFileSync(path.join(OUT, f), s.trim() + '\n'); console.log('wrote', f) }

const SOURCES = `**Sources in this repository:** \`docs/APEX_BROCHURE_INPUT_PACK.md\` (feature inventory with LIVE / IN PROGRESS / ROADMAP status and evidence), \`docs/APEX_MASTER_PLAN.md\` (findings, personas, maturity), \`docs/implementation/APEX_IMPLEMENTATION_STATUS.md\`, \`docs/adr/\` and the product READMEs.`

const FACTS = `## What APEX actually is (repository analysis)

APEX ("Inspironics APEX") is a **self-hosted** front door — a gateway with a dashboard — in front of three products. The organisation's files stay in its own Dropbox, and AI is optional.

${md(K.PRODUCT.modules.map((m) => [m.name, m.what, m.maturity]), ['Module', 'What it does today', 'Status'])}

**Verified facts usable in sales material:** three products behind one front door; 235 solution blueprints in the Showcase library; 567 automated tests, all passing at the last full run; zero third-party dependencies in the gateway; four voice-over providers supported in Academia. These come from section 7 of the brochure input pack. The Academia development-database totals are not used, because they reflect internal use on one machine.

**Honest limits — these must shape every commercial claim:**
- Deployment is self-hosted only. There is no SaaS, no multi-tenancy and no production deployment yet; hosted Postgres with HTTPS is in progress.
- There is no enterprise SSO (SAML/OIDC) or MFA yet; both are on the roadmap.
- Dropbox, email delivery and Google sign-in have been tested against mocks only; a live Dropbox connection across all products is on the roadmap.
- No paying customer, customer production use, ROI study or certification is evidenced in the repository. **None may be claimed.**
- Personal-data export and erasure self-service are on the roadmap.

${SOURCES}`

// ---------------------------------------------------------------- 1. strategy report ----
write('01_APEX_Commercial_Strategy_Report.md', `# APEX Commercial Strategy Report

${STAMP}

## Executive summary

**The question this answers:** how we take APEX to market, identify the right decision makers, educate them, communicate value and sell it as an enterprise solution.

**The answer in brief:**
1. **What we sell.** ${K.POSITIONING.selling}
2. **Who buys.** ${K.POSITIONING.whoBuys}
3. **Why they buy.** APEX turns know-how scattered across playbooks, decks and blueprints into a searchable portfolio, a ready sales library and certified team capability — behind one secure, self-hosted front door.
4. **How we sell.** We map each account to six personas plus governance. We educate each persona with its own material. We run a tailored demonstration, then convert interest into a **paid 8–12 week pilot** with written success criteria, and convert pilot evidence into an annual licence.
5. **What we must not do.** We must not claim customers, ROI, certifications, integrations or prices that do not exist. We must not present roadmap items (hosting, SSO, live Dropbox) as live.

${FACTS}

## Business and market analysis

### The problems that justify a purchase
${K.PRODUCT.problems.map((p) => `- **${p.title}.** ${p.text}`).join('\n')}

### Addressable segments (hypotheses to validate)
${md(K.SEGMENTS.industries.map((s) => [s.name, s.priority, s.why]), ['Segment', 'Priority', 'Why APEX fits'])}

${md(K.SEGMENTS.orgTypes.map((o) => [o.name, o.note]), ['Organisation type', 'Fit'])}

**Commercial opportunities:**
${list(K.SEGMENTS.opportunities)}

${K.SEGMENTS.note}

## Positioning
See \`05_APEX_Commercial_Positioning.md\`. Positioning statement:

> ${K.POSITIONING.statement}

## Personas and the buying group
See \`02_APEX_Customer_Persona_Intelligence.md\` for the full 18-attribute profiles.

${md(P.map((p) => [`${p.id} — ${p.name}`, p.role, p.authority, p.influence]), ['Persona', 'Buying role', 'Decision authority', 'Influence'])}

## Customer education
See \`03_APEX_Educational_Material_Matrix.md\`. Every persona gets different material. Build first: product overview, executive infographic, business value presentation, persona demo videos, technical overview with security brief, and the pilot proposal.

## Sales funnel, engagement and conversion
See \`04_APEX_Sales_Funnel.md\`. The funnel has 15 stages, and the paid pilot (stage 9) is its pivot. There are four plays into an account: top-down, middle-out, technical-first and partner-led.

## Pricing framework
No prices are set. Recommended models and the information needed to set prices are in \`05_APEX_Commercial_Positioning.md\`.

## A0 infographic series
${md(POSTERS.map((p) => [String(p.n).padStart(2, '0'), p.title, `\`${p.dir}/${p.file}.png\` · \`.pdf\` · \`source.svg\``]), ['#', 'Poster', 'Files'])}

## Next steps
See \`06_APEX_Next_Steps.md\`.
`)

// ---------------------------------------------------------------- 2. personas ----
const ATTR = (p) => [
  ['1. Persona name', `${p.id} — ${p.name}`],
  ['2. Job titles', p.titles.join(', ')],
  ['3. Organisation type', p.orgType],
  ['4. Decision-making authority', p.authority],
  ['5. Buying influence', `${p.influence} · buying role: **${p.role}**`],
  ['6. Business challenges', p.challenges.join('; ')],
  ['7. Existing pain points', p.pains.join('; ')],
  ['8. Business expectations', p.expectations.join('; ')],
  ['9. What they expect from APEX', p.expectsFromApex],
  ['10. APEX value proposition', p.value],
  ['11. Key selling message', `“${p.message}”`],
  ['12. Relevant APEX features (all LIVE)', p.features.join('; ')],
  ['13. Potential buying objections', p.objections.map((o) => o.q).join(' ')],
  ['14. Recommended sales response', p.objections.map((o) => `${o.q} → ${o.a}`).join('<br>')],
  ['15. Educational materials required', p.materials.join('; ')],
  ['16. Preferred marketing channels', p.channels.join('; ')],
  ['17. Recommended CTA', p.cta],
  ['18. Conversion strategy', p.conversion],
]
const G = K.GOVERNANCE_STAKEHOLDER
write('02_APEX_Customer_Persona_Intelligence.md', `# APEX Customer Persona Intelligence

${STAMP}

The six personas below refine the initial categories against what APEX actually does. APEX is bought by organisations whose value is expert know-how, so the buying group centres on executives, functional heads (engineering, sales and pre-sales, L&D), technology leaders and the people who run and use content daily.

## Buying roles

${md(K.BUYING_ROLES.map((b) => [b.role, b.who]), ['Buying role', 'Who plays it'])}

**Procurement / governance stakeholder** (${G.titles.join(', ')}): concerns are ${G.concerns.join('; ')}. They need: ${G.needs.join('; ')}. *Be honest:* ${G.honest}

${P.map((p) => `## Persona ${p.id} — ${p.name}

${md(ATTR(p), ['Attribute', 'Profile'])}
`).join('\n')}
`)

// ---------------------------------------------------------------- 3. materials ----
const mark = (v) => (v === 2 ? '●' : v === 1 ? '○' : '')
write('03_APEX_Educational_Material_Matrix.md', `# APEX Persona-Based Educational Material Matrix

${STAMP}

● = primary material built for that persona · ○ = supporting material.

${md(K.MATERIALS.map((m) => [m.name, m.purpose, ...P.map((p) => mark(m.personas[p.id] || 0))]), ['Material', 'Purpose', ...P.map((p) => `${p.id} ${p.short}`)])}

**Honesty rules:** case studies are created only after a pilot report the customer agrees to publish. The ROI calculator takes the customer's own baselines and shows no default results. Interactive demos use the built-in demo modes with sample data, labelled as illustrative.

## What to teach each persona

${P.map((p) => `### Persona ${p.id} — ${p.name}
${md([
  ['What should we teach them?', p.teach.teach],
  ['What problem should we highlight?', p.teach.problem],
  ['Which APEX capability should we showcase?', p.teach.capability],
  ['Which infographic should we create?', p.teach.infographic],
  ['Which video or presentation should we prepare?', p.teach.video],
  ['What should they understand afterwards?', p.teach.understand],
  ['What action should they take next?', p.teach.next],
  ['Message to deliver', `“${p.message}”`],
], ['Question', 'Answer'])}
`).join('\n')}

## Production order
1. Product overview and executive infographic (all personas, first touch).
2. Business value presentation and pilot proposal (A, B).
3. Persona demo scripts and recorded demo videos (B, C, E).
4. Technical overview with security and governance brief (D, governance).
5. Industry problem infographic and use case documents (B, F).
6. Workflow infographics, quick-start guide and FAQ (C, E).
7. ROI calculator (customer inputs only), commercial proposal template, partner programme brief.
8. Case studies — only after the first pilot report.
`)

// ---------------------------------------------------------------- 4. funnel ----
write('04_APEX_Sales_Funnel.md', `# APEX Enterprise Sales Funnel, Journey and Buying Decision

${STAMP}

## The 15-stage funnel

${md(K.FUNNEL.map((s, i) => [i + 1, s.stage, s.objective, s.expectation, s.material, s.activity, s.outcome, s.metric]), ['#', 'Stage', 'Business objective', 'Customer expectation', 'Required material', 'Sales activity', 'Expected outcome', 'Conversion metric'])}

Stages 1–5 are marketing-led, 6–12 sales-led, and 13–15 customer-success-led. **The paid pilot (stage 9) is the pivot:** earlier stages earn the right to a pilot, and later stages turn pilot evidence into a contract.

### Pilot design (recommended)
- 8–12 weeks, paid, on the customer's own infrastructure (self-hosted).
- One or two modules, one or two teams, a named champion (persona C) and a sponsor (persona A or B).
- Written success criteria agreed before the start, measured from APEX's own analytics and completion records, against a baseline taken before the pilot.
- Weekly check-ins, then a pilot report the customer signs off, with a go/no-go on the licence.

## Customer acquisition journey

${md(K.JOURNEY.map((j, i) => [i + 1, j.phase, j.touch, j.feel, j.our]), ['#', 'Phase', 'Touchpoint', 'Customer feels', 'What we do'])}

## Engagement strategy

${md(K.ENGAGEMENT.map((e) => [e.segment, e.entry, e.lead, `“${e.message}”`, e.offer]), ['Segment', 'Entry persona', 'Lead with', 'Opening message', 'First offer'])}

${K.ENGAGEMENT_PLAYS.map((p) => `- **${p.name}:** ${p.text}`).join('\n')}

## Persona demonstrations

${md(K.DEMOS.map((d) => [`${d.persona} ${K.PERSONAS.find((p) => p.id === d.persona).short}`, d.length, d.show, d.proof, d.avoid, d.close]), ['Persona', 'Length', 'Show', 'Proof point', 'Avoid', 'Close on'])}

**Demo rules:**
${list(K.DEMO_RULES)}

## Enterprise buying decision journey

${md(K.BUYING_STAGES.map((s, i) => [i + 1, s.stage, s.who, s.objection, s.approval]), ['#', 'Stage', 'Stakeholders', 'Typical objection', 'Approval gate'])}
`)

// ---------------------------------------------------------------- 5. positioning ----
write('05_APEX_Commercial_Positioning.md', `# APEX Commercial Positioning

${STAMP}

## Positioning statement
> ${K.POSITIONING.statement}

## The questions answered
- **What exactly are we selling?** ${K.POSITIONING.selling}
- **Who should buy it?** ${K.POSITIONING.whoBuys}
- **Why should they buy it?**
${K.POSITIONING.whyBuy.map((x) => `  - ${x}`).join('\n')}
- **Which business problems justify the purchase?**
${K.PRODUCT.problems.map((p) => `  - ${p.title}: ${p.text}`).join('\n')}
- **What makes APEX commercially valuable?**
${K.PRODUCT.differentiators.map((x) => `  - ${x}`).join('\n')}
- **How do we differentiate it from the alternatives?**

${md(K.POSITIONING.vsAlternatives.map((a) => [a.alt, a.apex]), ['Alternative', 'APEX position'])}

- **How do we communicate value to senior management?** In business outcomes, in the persona's own words (see Poster 09):

${md(P.map((p) => [`${p.id} ${p.short}`, `“${p.message}”`, p.value]), ['Persona', 'Message', 'Value'])}

- **What evidence must we prepare before making ROI claims?**
${K.POSITIONING.evidenceBeforeROI.map((x) => `  - ${x}`).join('\n')}

## What is on the roadmap (say so plainly)
${list(K.PRODUCT.roadmap)}

## Pricing framework (no prices are set)

${md(K.POSITIONING.pricingModels.map((m) => [m.model, m.fit]), ['Model', 'How it applies to APEX'])}

**Assessment of the requested models:**
- *Enterprise subscription / annual licensing:* recommended as an annual self-hosted organisation licence. A hosted subscription becomes possible only after hosted deployment is ready.
- *Modular pricing:* fits naturally, because the front door and Core are always included and Showcase, SlidesVault and Academia are modules.
- *Organisation-based vs user-based:* organisation licence with user bands. Pure per-seat billing does not fit a self-hosted install.
- *Implementation and support packages:* required. Installation, Dropbox connection, first content conversion and admin training.
- *Enterprise customisation:* offer as scoped professional services, not as product promises.

**Information needed to set prices:**
${list(K.POSITIONING.pricingInputs)}
`)

// ---------------------------------------------------------------- 6. next steps ----
write('06_APEX_Next_Steps.md', `# APEX Commercial Execution — Next Steps

${STAMP}

## 0–30 days: get ready to sell honestly
1. **Founder review** of this strategy, the personas and the 12 posters. Correct anything that does not match how the business wants to position APEX.
2. **Pick the beachhead:** one primary segment (recommended: engineering and technology services firms on Dropbox) and a list of 30 target accounts.
3. **Build the first materials** (production order in \`03_APEX_Educational_Material_Matrix.md\`): product overview, executive infographic, business value deck, pilot proposal, technical overview with security brief.
4. **Prepare a demo environment** using the built-in demo modes, with persona demo scripts (Poster 11). Show only LIVE features.
5. **Write the pilot offer:** scope, duration, success-criteria template, baseline measures and a pilot report template.

## 30–90 days: learn from the market
6. Hold **ten discovery conversations** to validate segments, personas and pains. Record findings and update \`content.mjs\` and the posters.
7. Run **tailored demonstrations** for qualified accounts; track demo-to-next-step conversion.
8. Sign **one or two paid pilots** on customer infrastructure.
9. Decide the **pricing inputs:** delivery cost per install, support cost and competitor price points.

## Product dependencies that unlock larger deals
These are owned by the product plan, not by sales. Sell around them honestly.
- Hosted deployment with Postgres and HTTPS (in progress).
- Enterprise SSO (SAML/OIDC) and MFA (roadmap).
- Live Dropbox connection in all products; email delivery for invites and reminders.
- Personal-data export and erasure self-service (roadmap), for data-protection reviews.

## 90+ days: convert and scale
10. Turn pilot reports into the first **case studies**, with written customer permission.
11. Publish the **price list** from real delivery costs and pilot value.
12. Launch a **partner programme** for integrators (Persona F).
13. Review the funnel metrics monthly and refresh the posters.

## Rules that never change
- No invented customers, ROI, certifications, integrations or prices.
- Roadmap items are always labelled as roadmap.
- Customer personal data never goes into sales material or this repository.
- Nothing is published externally, and no external organisation is onboarded, without founder authorisation.
`)

// ---------------------------------------------------------------- README ----
fs.writeFileSync(path.join(ROOT, 'README.md'), `# APEX Commercial Strategy

${STAMP}
This folder is the commercial blueprint for taking Inspironics APEX to market. It is separate from the product code: nothing here changes any application, route, database or workflow.

## Contents
- \`docs/\`: strategy report, persona intelligence, educational material matrix, sales funnel, positioning, next steps
- \`01_…\` to \`12_…\`: one A0 poster each. Every folder has:
  - \`*_A0.png\`: 9933 × 14043 px, RGB, 300 DPI
  - \`*_A0.pdf\`: one page, 841 × 1189 mm
  - \`source.svg\`: the editable vector
- \`APEX_Commercial_Infographics_Index.pdf\`: an A4 index of the series
- \`gallery/index.html\`: an offline Infographic Gallery and Persona Explorer (open in a browser)
- \`VALIDATION_REPORT.md\`: the checks run on every file
- \`_build/\`: the generator; all content lives in \`_build/content.mjs\`

## Posters
${md(POSTERS.map((p) => [String(p.n).padStart(2, '0'), p.title, `[PNG](${p.dir}/${p.file}.png) · [PDF](${p.dir}/${p.file}.pdf) · [SVG](${p.dir}/source.svg)`]), ['#', 'Poster', 'Files'])}

## Regenerate
Set TMP/TEMP to E: first (see AGENTS.md), then run from \`_build/\`:

\`\`\`
node svg.mjs        # source.svg files and previews
node render.mjs     # PNG (vector-rendered in strips) and PDF (Chrome, vector)
node docs.mjs       # documents
node index.mjs      # index PDF and gallery
node validate.mjs   # checks and VALIDATION_REPORT.md
\`\`\`

## Print notes
- The PDFs are vector RGB, at A0 page size with no bleed.
- No CMYK conversion tool is available in this environment. For offset printing, ask the print shop to convert the PDF to its CMYK profile (for example FOGRA39 or GRACoL), or export from \`source.svg\` in a CMYK-capable tool.
- Large-format inkjet printers accept the RGB PDF or PNG directly.
`)
console.log('wrote README.md')
