// APEX commercial strategy — the single source of content for the 12 A0 posters, the strategy documents
// and the gallery. Facts come from docs/APEX_BROCHURE_INPUT_PACK.md (feature maturity with evidence),
// docs/APEX_MASTER_PLAN.md and docs/implementation/*. Rule: no invented customers, ROI, certifications,
// integrations or prices. Capabilities are LIVE (built and tested), IN PROGRESS or ROADMAP.

export const META = {
  product: 'Inspironics APEX',
  edition: 'Commercial Strategy · November 2026',
  readiness:
    'Readiness: capabilities marked LIVE are built and tested; none is yet proven in a customer production environment. No customer results, ROI, certifications or prices are claimed.',
}

export const PALETTE = {
  navy: '#0B1736', navy2: '#13224A', ink: '#0F172A', ink2: '#334155', muted: '#64748B', line: '#E2E8F0', paper: '#F7F9FC', white: '#FFFFFF',
  cyan: '#06B6D4', teal: '#0D9488', violet: '#7C3AED', blue: '#2563EB', amber: '#D97706', rose: '#E11D48', green: '#059669', slate: '#475569',
}

// ---------------------------------------------------------------- the product, as built ----
export const PRODUCT = {
  oneLiner: 'One secure front door to an organisation’s solution portfolio, sales presentations and engineering learning — self-hosted, on the storage it already owns.',
  modules: [
    { name: 'APEX Front Door & Core', icon: 'shield', color: 'navy', what: 'Single sign-in and sign-out across products, live status dashboard, cross-product search, Core identity with scoped roles, organisations, audit log and governed onboarding.', maturity: 'LIVE' },
    { name: 'Innovation Showcase', icon: 'spark', color: 'cyan', what: 'Curated library of 235 solution blueprints, search and filters, 3D ecosystem explorer, Daily Spotlight, usage analytics and a monthly PDF report.', maturity: 'LIVE' },
    { name: 'SlidesVault', icon: 'deck', color: 'violet', what: 'Presentation library: ranked search, built-in viewer with page bookmarks, installable offline reading, view and reading-time analytics.', maturity: 'LIVE' },
    { name: 'Inspironics Academia', icon: 'cap', color: 'teal', what: 'Playbooks become courses with server-graded tests, verifiable certificates, recertification when playbooks change, spaced review, and meetings turned into owned action items.', maturity: 'LIVE' },
  ],
  problems: [
    { title: 'Knowledge scattered across folders', text: 'Blueprints, decks and playbooks sit in shared folders: hard to find, hard to present, and no one knows what is used.' },
    { title: 'Playbooks nobody learns from', text: 'Engineering playbooks are written once and rarely read; there is no proof of who knows them or when they went out of date.' },
    { title: 'Too many tools, too many logins', text: 'Each tool has its own address and password; access, roles and audit are inconsistent and hard to govern.' },
  ],
  differentiators: [
    'Self-hosted: data stays on the customer’s servers and in its own Dropbox; files are proxied, never linked.',
    'Playbook-to-certificate pipeline with traceability from every lesson back to its source chapter.',
    'Assessment integrity: grading on the server, answers never reach the browser, certificates publicly verifiable.',
    'AI drafts, people decide: AI is optional, human-approved, with daily and monthly spend caps.',
    'One governed identity: scoped roles, organisations and an audit trail across products.',
  ],
  roadmap: ['Hosted deployment with Postgres and HTTPS', 'Enterprise single sign-on (SAML/OIDC)', 'Live Dropbox connection in all products', 'Email delivery for invites and reminders', 'Privacy self-service: data export and erasure'],
}

// ---------------------------------------------------------------- positioning ----
export const POSITIONING = {
  statement:
    'For engineering and technology-services organisations whose know-how lives in playbooks, decks and blueprints, APEX is a self-hosted knowledge-to-capability platform that turns scattered material into a searchable portfolio, a ready sales library and verified team capability — behind one secure front door.',
  selling: 'An annual, self-hosted platform licence (front door and Core, plus modules) with an implementation package and a paid pilot as the entry point.',
  whoBuys: 'Mid-sized engineering, technology-services and solution-integrator firms (about 200–5,000 people) that already store their know-how in Dropbox.',
  whyBuy: [
    'Faster, consistent pre-sales: the right deck and blueprint, found and presented in minutes.',
    'Evidence of capability: who completed which playbook, with certificates anyone can verify.',
    'Currency: people re-certify automatically when a playbook changes.',
    'Governance: one sign-in, scoped roles, audit, and data that never leaves the organisation.',
  ],
  vsAlternatives: [
    { alt: 'Generic LMS', apex: 'APEX builds courses from your own playbooks and keeps them current; an LMS needs content made for it.' },
    { alt: 'File shares / intranet', apex: 'APEX makes material searchable, presentable and measured, without moving it out of Dropbox.' },
    { alt: 'Sales enablement SaaS', apex: 'APEX is self-hosted and joins sales content with engineering capability in one front door.' },
    { alt: 'Building in-house', apex: 'APEX is built and tested today; a pilot runs in weeks rather than a build taking quarters.' },
  ],
  evidenceBeforeROI: [
    'Baseline before the pilot: time to find a deck, playbook completion, time to onboard a new engineer.',
    'Pilot measurements from the customer’s own usage analytics and completion records.',
    'A signed pilot report the customer agrees can be quoted.',
    'Security review outcome and the customer’s hosting decision.',
  ],
  pricingModels: [
    { model: 'Organisation licence (annual)', fit: 'Recommended core: one self-hosted install per organisation.' },
    { model: 'Modular pricing', fit: 'Front Door & Core always included; Showcase, SlidesVault, Academia as modules.' },
    { model: 'User bands', fit: 'Tiers by named users (for example up to 250, 1,000, 5,000) rather than per-seat billing.' },
    { model: 'Implementation package', fit: 'Installation, Dropbox connection, first playbooks converted, admin training.' },
    { model: 'Content conversion service', fit: 'Playbook-to-course conversion and review as a fixed-scope service.' },
    { model: 'Support & updates tier', fit: 'Standard and priority support with update entitlement.' },
    { model: 'AI usage', fit: 'Customer’s own AI keys; APEX enforces budgets. No AI margin assumed.' },
  ],
  pricingInputs: [
    'Cost to deliver an install and support it per year',
    'Pilot findings on value per user and per module',
    'Competitor and alternative price points in target markets',
    'Customer budget owners and procurement thresholds',
    'Hosting choice (customer-hosted or managed) once hosting is ready',
  ],
}

// ---------------------------------------------------------------- segments ----
export const SEGMENTS = {
  industries: [
    { name: 'Engineering & technology services', why: 'Playbook-to-course pipeline, recertification when playbooks change, meeting action items.', priority: 'Primary', icon: 'gear' },
    { name: 'Solution & system integrators', why: 'Smart buildings, energy, IoT: Showcase taxonomy of 11 technologies and 8 industry zones for blueprints.', priority: 'Primary', icon: 'network' },
    { name: 'B2B technology pre-sales & sales', why: 'SlidesVault: find, present and measure the right deck, online or offline.', priority: 'Primary', icon: 'deck' },
    { name: 'Dropbox-standardised organisations', why: 'All products sync from Dropbox; files are proxied through APEX, never linked.', priority: 'Secondary', icon: 'cloud' },
    { name: 'Organisations requiring self-hosting', why: 'Regulated or IP-sensitive firms that keep data on their own servers.', priority: 'Secondary', icon: 'lock' },
    { name: 'Training & academic partners', why: 'Future: student, intern and alumni journeys from the APEX master plan.', priority: 'Future', icon: 'cap' },
  ],
  orgTypes: [
    { name: 'Mid-sized firms (200–5,000 people)', note: 'Primary: enough know-how to organise, fast decisions, one install.' },
    { name: 'Business units of large enterprises', note: 'Secondary: a division pilot that can expand.' },
    { name: 'Growing specialists (50–200 people)', note: 'Secondary: lighter package, fast onboarding of new hires.' },
    { name: 'Partners & integrators', note: 'Channel: resell, implement and convert content.' },
  ],
  opportunities: [
    'Land with one module where pain is sharpest (often SlidesVault for sales or Academia for engineering).',
    'Expand to the full front door once one team sees value.',
    'Content conversion services as recurring, high-trust revenue.',
    'Partner channel with integrators who already serve these industries.',
  ],
  note: 'Segments and size bands are hypotheses to validate in the first 10 discovery conversations.',
}

// ---------------------------------------------------------------- personas ----
export const PERSONAS = [
  {
    id: 'A', key: 'exec', name: 'Executive Decision Makers', short: 'Executives', color: 'navy', icon: 'crown',
    titles: ['CEOs', 'Managing Directors', 'Executive Directors', 'Company Founders', 'Board Members'],
    orgType: 'Owner-led or professionally managed services firms', role: 'Economic Buyer',
    authority: 'Final approval and budget owner', influence: 'Very high', tier: 1,
    challenges: ['Growth depends on a few experts', 'Know-how leaves with people', 'Hard to show capability to clients'],
    pains: ['No view of team capability', 'Slow, inconsistent proposals', 'Tool sprawl with unclear value'],
    expectations: ['Strategic visibility', 'Competitive advantage', 'Low risk and clear payback'],
    expectsFromApex: 'A credible way to scale expertise and win work, with low risk to data and budget.',
    value: 'Turn the firm’s know-how into visible, verified capability and faster wins — on infrastructure you control.',
    message: 'Your expertise is your product. APEX makes it findable, teachable and provable.',
    features: ['Front-door dashboard and usage analytics', 'Verifiable certificates', 'Self-hosted, own Dropbox'],
    objections: [{ q: 'Is this proven?', a: 'Propose a paid 8–12 week pilot with agreed success measures and a go/no-go.' }, { q: 'We already have tools.', a: 'APEX joins them behind one door and adds capability evidence they lack.' }],
    materials: ['Executive infographic', 'Business value presentation', 'Pilot proposal'],
    channels: ['Founder-to-founder introductions', 'LinkedIn thought leadership', 'Industry events'],
    cta: 'Approve a scoped pilot',
    conversion: 'Executive briefing → sponsor named → paid pilot with success criteria.',
    teach: { teach: 'Know-how is an asset you can organise, prove and scale.', problem: 'Expertise trapped in people and folders.', capability: 'Playbook → course → verifiable certificate; one front door.', infographic: 'Executive infographic (Poster 01, 09)', video: '3-minute business value video', understand: 'APEX turns knowledge into measurable capability with low risk.', next: 'Name a sponsor and approve a pilot.' },
  },
  {
    id: 'B', key: 'senior', name: 'Senior Management', short: 'Senior Managers', color: 'blue', icon: 'chart',
    titles: ['Vice Presidents', 'Business Unit Heads', 'Department Directors (Engineering, Sales, Pre-sales)', 'General Managers', 'Regional Heads'],
    orgType: 'Functional and business-unit leadership', role: 'Business Decision Maker',
    authority: 'Recommends and owns the business case', influence: 'High', tier: 2,
    challenges: ['Teams reinvent material', 'Uneven skills across regions', 'Pressure on win rate and delivery quality'],
    pains: ['Cannot see who knows what', 'Stale decks in client meetings', 'Onboarding takes too long'],
    expectations: ['Accountability', 'Operational visibility', 'Measurable team performance'],
    expectsFromApex: 'Proof that teams use current material and know current playbooks.',
    value: 'See usage and completion by team; keep sales and engineering on current material.',
    message: 'Know what your teams use and know — and keep it current automatically.',
    features: ['Usage analytics (Showcase, SlidesVault)', 'Completion and compliance view with CSV export', 'Recertification on playbook change'],
    objections: [{ q: 'Will people use it?', a: 'One sign-in and familiar content; adoption is measured from day one.' }, { q: 'Content effort?', a: 'AI drafts courses from existing playbooks; a conversion service is available.' }],
    materials: ['Business value presentation', 'Industry use case document', 'Product demo video'],
    channels: ['Referral from executive sponsor', 'Targeted email sequences', 'Webinars'],
    cta: 'Book a tailored demonstration',
    conversion: 'Discovery meeting → tailored demo → joint pilot plan with success measures.',
    teach: { teach: 'How usage and completion data drive accountability.', problem: 'Stale, scattered material and invisible skills.', capability: 'Analytics, compliance view, recertification.', infographic: 'Pain points vs business value (Poster 04)', video: 'Department-level demo video', understand: 'They can manage capability and content currency by team.', next: 'Book a demo and nominate pilot teams.' },
  },
  {
    id: 'C', key: 'ops', name: 'Business & Operations Leaders', short: 'Ops Leaders', color: 'teal', icon: 'flow',
    titles: ['Operations Managers', 'Business & Pre-sales Managers', 'Project Managers', 'Process Owners', 'Functional Heads (e.g. L&D)'],
    orgType: 'Line management running daily processes', role: 'Business Influencer · Champion',
    authority: 'Shapes requirements; runs the pilot', influence: 'Medium–high', tier: 3,
    challenges: ['Manual tracking of training', 'Decks and playbooks out of sync', 'Meeting decisions not followed up'],
    pains: ['Spreadsheets for compliance', 'Hunting for the latest material', 'Lost action items'],
    expectations: ['Workflow efficiency', 'Less admin', 'Clear process visibility'],
    expectsFromApex: 'Less manual work and one place to run learning and content.',
    value: 'Automate course creation, reminders, recertification and meeting follow-ups.',
    message: 'Spend your time improving the process, not chasing it.',
    features: ['AI-drafted, human-approved courses', 'Reminders and spaced review', 'Meetings → owned action items'],
    objections: [{ q: 'Another system to run?', a: 'One command install, admin console, and a guided implementation package.' }, { q: 'AI quality?', a: 'Quality checks flag weak lessons; nothing is published without approval.' }],
    materials: ['Workflow infographic', 'Interactive product demo', 'Implementation roadmap'],
    channels: ['Practitioner webinars', 'Community and LinkedIn groups', 'Hands-on demo sandbox'],
    cta: 'Try the interactive demo',
    conversion: 'Hands-on demo → champion → pilot owner with weekly check-ins.',
    teach: { teach: 'The playbook-to-certificate workflow and its admin effort.', problem: 'Manual compliance and lost follow-ups.', capability: 'Content pipeline, compliance view, action items.', infographic: 'Workflow infographic (Poster 05)', video: 'Admin walkthrough video', understand: 'How much manual work APEX removes.', next: 'Become the pilot champion.' },
  },
  {
    id: 'D', key: 'tech', name: 'Technology Decision Makers', short: 'Technology', color: 'violet', icon: 'chip',
    titles: ['CIOs', 'CTOs', 'IT Directors', 'Digital Transformation Heads', 'Enterprise Architects'],
    orgType: 'IT and architecture function', role: 'Technical Evaluator',
    authority: 'Technical approval or veto', influence: 'High (can block)', tier: 2,
    challenges: ['Security and data residency', 'Integration with existing storage', 'Run cost and support load'],
    pains: ['SaaS data leaving the network', 'Unclear AI data handling', 'Tool sprawl'],
    expectations: ['Security', 'Scalability', 'Implementation feasibility'],
    expectsFromApex: 'A secure, self-hosted design that is simple to operate and audit.',
    value: 'Self-hosted, server-side access checks, encrypted tokens, audit log, optional AI with budgets.',
    message: 'Your data, your servers, your rules — with one governed identity.',
    features: ['Core identity, scoped roles, audit', 'Encrypted Dropbox tokens; proxied files', 'AI optional, capped, provider fallback'],
    objections: [{ q: 'SSO and MFA?', a: 'Enterprise SSO is on the roadmap; scope it into the pilot plan honestly.' }, { q: 'Production hosting?', a: 'Hosted deployment is in progress; pilot on the customer’s infrastructure.' }],
    materials: ['Technical overview', 'Security & governance brief', 'Architecture diagram'],
    channels: ['Technical briefing calls', 'Architecture review sessions', 'Documentation portal'],
    cta: 'Schedule a technical review',
    conversion: 'Architecture review → security questionnaire → technical sign-off for pilot.',
    teach: { teach: 'Architecture, security controls and data flows.', problem: 'Risk of data leaving the organisation.', capability: 'Self-hosting, proxied storage, audit, identity.', infographic: 'Technical overview sheet', video: 'Architecture explainer', understand: 'APEX can run safely in their environment.', next: 'Complete the technical review.' },
  },
  {
    id: 'E', key: 'users', name: 'Department-Level Users', short: 'End Users', color: 'green', icon: 'users',
    titles: ['Team Leaders', 'Supervisors', 'Employees (engineers, consultants)', 'Analysts', 'Operational Executives'],
    orgType: 'Daily users across functions', role: 'End User',
    authority: 'No budget; adoption decides renewal', influence: 'Medium (adoption)', tier: 4,
    challenges: ['Finding the right material fast', 'Learning on the job', 'Too many logins'],
    pains: ['Searching folders', 'Long, unread playbooks', 'Forgotten follow-ups'],
    expectations: ['Ease of use', 'Fast search', 'Learning that fits the day'],
    expectsFromApex: 'One sign-in, instant search, short lessons and offline access.',
    value: 'Find, present and learn in minutes, from one sign-in, even offline.',
    message: 'Everything you need for your next client meeting or project — in one place.',
    features: ['One sign-in, cross-product search', 'Offline deck reading', 'Short lessons, flashcards, certificates'],
    objections: [{ q: 'Is it extra work?', a: 'It replaces folder hunting; lessons are short and spaced.' }],
    materials: ['Quick-start guide', 'Short feature videos', 'FAQ'],
    channels: ['In-app onboarding', 'Team launch sessions', 'Internal champions'],
    cta: 'Join the pilot team',
    conversion: 'Launch session → weekly active use → feedback into the pilot report.',
    teach: { teach: 'How to find, present and learn in APEX.', problem: 'Time lost searching and re-learning.', capability: 'Search, viewer, offline, short lessons.', infographic: 'Quick-start one-pager', video: '60-second feature clips', understand: 'APEX saves them time every day.', next: 'Use it weekly during the pilot.' },
  },
  {
    id: 'F', key: 'partner', name: 'Strategic Business Partners', short: 'Partners', color: 'amber', icon: 'handshake',
    titles: ['Consultants', 'Industry Partners', 'Enterprise Solution Partners', 'System Integrators', 'Business Development Partners'],
    orgType: 'Firms serving the target industries', role: 'Channel · Influencer',
    authority: 'Recommends to their clients', influence: 'Medium–high (reach)', tier: 3,
    challenges: ['Differentiating their services', 'Repeatable delivery IP', 'New recurring revenue'],
    pains: ['One-off projects', 'Clients lacking enablement tools'],
    expectations: ['Partnership terms', 'Enablement', 'Revenue share'],
    expectsFromApex: 'A product they can implement, resell and wrap services around.',
    value: 'Implementation and content-conversion services around a ready platform.',
    message: 'Add a capability platform to your offering — and services around it.',
    features: ['Self-hosted installs per client', 'Content conversion pipeline', 'Demo modes with sample data'],
    objections: [{ q: 'Margins and support?', a: 'Define partner tiers, enablement and support split in a partner agreement.' }],
    materials: ['Partner programme brief', 'Implementation playbook', 'Demo environment'],
    channels: ['Partner outreach', 'Industry associations', 'Co-marketing events'],
    cta: 'Discuss a partnership',
    conversion: 'Partner briefing → enablement → first joint opportunity.',
    teach: { teach: 'How partners earn with APEX.', problem: 'Undifferentiated services.', capability: 'Implementation and conversion services.', infographic: 'Commercial engagement (Poster 10)', video: 'Partner overview', understand: 'APEX can expand their services revenue.', next: 'Sign a partner agreement.' },
  },
]

export const GOVERNANCE_STAKEHOLDER = {
  name: 'Procurement & Governance', role: 'Procurement / Governance Stakeholder', titles: ['Procurement', 'Information security', 'Legal / Data protection officer', 'Finance'],
  concerns: ['Data protection and residency (GDPR, DPDP)', 'Contract, liability and support terms', 'Security questionnaire', 'Total cost of ownership'],
  needs: ['Security & governance brief', 'Data processing terms', 'Commercial proposal with clear scope'],
  honest: 'Personal-data export and erasure are on the roadmap; disclose and plan them in the contract.',
}

export const BUYING_ROLES = [
  { role: 'Economic Buyer', who: 'CEO / MD (Persona A)' },
  { role: 'Business Decision Maker', who: 'VP / BU Head (Persona B)' },
  { role: 'Technical Evaluator', who: 'CIO / CTO / IT (Persona D)' },
  { role: 'Business Influencer · Champion', who: 'L&D / Pre-sales / Ops lead (Persona C)' },
  { role: 'End User', who: 'Engineers and consultants (Persona E)' },
  { role: 'Procurement / Governance', who: 'Procurement, InfoSec, Legal, Finance' },
]

// ---------------------------------------------------------------- materials ----
export const MATERIALS = [
  { name: 'Executive infographic', purpose: 'Business value at a glance', personas: { A: 2, B: 1, F: 1 } },
  { name: 'Industry problem infographic', purpose: 'Industry pain points', personas: { A: 1, B: 2, C: 1, F: 2 } },
  { name: 'Product overview', purpose: 'Introduce the platform', personas: { A: 1, B: 2, C: 2, D: 1, E: 1, F: 2 } },
  { name: 'Business value presentation', purpose: 'Commercial benefits', personas: { A: 2, B: 2, F: 1 } },
  { name: 'Product demo video', purpose: 'Real capabilities', personas: { B: 2, C: 2, E: 1, F: 1 } },
  { name: 'Interactive demo (sample data)', purpose: 'Hands-on exploration', personas: { C: 2, E: 2, F: 2 } },
  { name: 'Industry use case documents', purpose: 'Practical applications', personas: { A: 1, B: 2, C: 1, F: 2 } },
  { name: 'Workflow infographics', purpose: 'How processes change', personas: { B: 1, C: 2, E: 1 } },
  { name: 'ROI calculator (customer inputs)', purpose: 'Estimate value with own baselines', personas: { A: 2, B: 2 } },
  { name: 'Technical overview', purpose: 'Architecture and operations', personas: { D: 2, F: 1 } },
  { name: 'Security & governance brief', purpose: 'Enterprise trust', personas: { A: 1, D: 2 } },
  { name: 'Implementation roadmap', purpose: 'Adoption plan', personas: { B: 1, C: 2, D: 1, F: 2 } },
  { name: 'Pilot proposal', purpose: 'Low-risk first step', personas: { A: 2, B: 2, C: 1 } },
  { name: 'Commercial proposal', purpose: 'Scope and pricing', personas: { A: 2, B: 1 } },
  { name: 'FAQ & objection guide', purpose: 'Answer concerns', personas: { C: 1, D: 1, E: 2, F: 1 } },
  { name: 'Case studies (after pilots)', purpose: 'Verified results only', personas: { A: 1, B: 1, F: 1 } },
]

// ---------------------------------------------------------------- funnel ----
export const FUNNEL = [
  { stage: 'Market Awareness', objective: 'Be known in target segments', expectation: 'Relevant insight', material: 'Thought-leadership posts, infographics', activity: 'Content and events', outcome: 'Engaged audience', metric: 'Reach, followers' },
  { stage: 'Target Customer Identification', objective: 'Build the account list', expectation: '—', material: 'Ideal customer profile', activity: 'Account research', outcome: 'Prioritised accounts', metric: 'Qualified accounts' },
  { stage: 'Persona Identification', objective: 'Map the buying group', expectation: '—', material: 'Persona playbook', activity: 'Stakeholder mapping', outcome: 'Named contacts by role', metric: 'Contacts per account' },
  { stage: 'Customer Education', objective: 'Teach the problem and approach', expectation: 'Useful, specific content', material: 'Persona infographics, videos', activity: 'Nurture sequences', outcome: 'Informed prospects', metric: 'Content engagement' },
  { stage: 'Lead Generation', objective: 'Capture interest', expectation: 'Easy next step', material: 'Webinar, demo offer', activity: 'Campaigns, referrals', outcome: 'Leads', metric: 'Marketing qualified leads' },
  { stage: 'Business Discovery', objective: 'Understand pain and fit', expectation: 'Being understood', material: 'Discovery guide', activity: 'Discovery meeting', outcome: 'Qualified opportunity', metric: 'Sales qualified leads' },
  { stage: 'Product Demonstration', objective: 'Show real capability', expectation: 'Their scenario, not a tour', material: 'Persona demo scripts', activity: 'Tailored demo', outcome: 'Interest confirmed', metric: 'Demo to next step rate' },
  { stage: 'Business Value Presentation', objective: 'Agree the value case', expectation: 'Honest numbers', material: 'Value deck, ROI calculator', activity: 'Value workshop', outcome: 'Shared success measures', metric: 'Agreed measures' },
  { stage: 'Pilot / Proof of Concept', objective: 'Prove value in their setting', expectation: 'Low risk, clear exit', material: 'Pilot proposal, plan', activity: '8–12 week paid pilot', outcome: 'Evidence and champions', metric: 'Pilot success rate' },
  { stage: 'Commercial Proposal', objective: 'Present scope and price', expectation: 'Clear, fair terms', material: 'Commercial proposal', activity: 'Proposal review', outcome: 'Proposal accepted in principle', metric: 'Proposal win rate' },
  { stage: 'Negotiation', objective: 'Resolve terms', expectation: 'Flexibility', material: 'Security brief, contract terms', activity: 'Procurement and legal', outcome: 'Agreed terms', metric: 'Days in negotiation' },
  { stage: 'Contract Closure', objective: 'Sign', expectation: 'Smooth signature', material: 'Order form', activity: 'Approval and signature', outcome: 'Signed contract', metric: 'Closed-won value' },
  { stage: 'Customer Onboarding', objective: 'Go live quickly', expectation: 'Guided setup', material: 'Implementation roadmap', activity: 'Install, connect, train', outcome: 'Live and adopted', metric: 'Time to first value' },
  { stage: 'Customer Retention', objective: 'Sustain value', expectation: 'Support and progress', material: 'Quarterly value review', activity: 'Success reviews', outcome: 'Renewal', metric: 'Gross retention' },
  { stage: 'Upselling & Expansion', objective: 'Grow the account', expectation: 'More value', material: 'Expansion plan', activity: 'New modules and teams', outcome: 'Expansion revenue', metric: 'Net revenue retention' },
]

// ---------------------------------------------------------------- journey ----
export const JOURNEY = [
  { phase: 'Discover', touch: 'Sees an APEX infographic or post', feel: 'Curious', our: 'Insight-led content per persona' },
  { phase: 'Learn', touch: 'Reads the product overview, watches a video', feel: 'Interested', our: 'Education sequence' },
  { phase: 'Engage', touch: 'Joins a webinar or asks for a demo', feel: 'Hopeful', our: 'Fast, personal response' },
  { phase: 'Evaluate', touch: 'Tailored demo, technical review', feel: 'Testing', our: 'Honest scope, real product' },
  { phase: 'Prove', touch: 'Paid pilot with success measures', feel: 'Convinced or not', our: 'Weekly check-ins, pilot report' },
  { phase: 'Buy', touch: 'Proposal, procurement, signature', feel: 'Committed', our: 'Clear terms, smooth approvals' },
  { phase: 'Onboard', touch: 'Install, Dropbox, first courses', feel: 'Supported', our: 'Implementation package' },
  { phase: 'Adopt', touch: 'Teams use it weekly', feel: 'Productive', our: 'Champions, usage reviews' },
  { phase: 'Expand', touch: 'More modules and teams', feel: 'Invested', our: 'Quarterly value reviews' },
  { phase: 'Advocate', touch: 'Agrees to a case study', feel: 'Proud', our: 'Co-marketing, references' },
]

// ---------------------------------------------------------------- engagement ----
export const ENGAGEMENT = [
  { segment: 'Engineering & tech services', entry: 'Head of Engineering / L&D', lead: 'Academia', message: 'Your playbooks, taught and certified.', offer: 'Playbook-to-course pilot' },
  { segment: 'Solution & system integrators', entry: 'Head of Pre-sales / Marketing', lead: 'Showcase + SlidesVault', message: 'Show your portfolio; win with the right deck.', offer: 'Portfolio & deck library pilot' },
  { segment: 'B2B tech sales teams', entry: 'VP Sales', lead: 'SlidesVault', message: 'Every deck, findable and measured.', offer: 'Sales library pilot' },
  { segment: 'Self-hosting / IP-sensitive', entry: 'CIO / CTO', lead: 'Front Door & Core', message: 'Your data stays yours.', offer: 'Technical review + on-prem pilot' },
  { segment: 'Partners & integrators', entry: 'Partner principal', lead: 'All modules', message: 'Add a platform and services revenue.', offer: 'Partner enablement' },
]
export const ENGAGEMENT_PLAYS = [
  { name: 'Top-down', text: 'Executive briefing names a sponsor; sponsor opens doors to B, C and D.' },
  { name: 'Middle-out', text: 'A department head with acute pain runs a pilot; results go up to A.' },
  { name: 'Technical-first', text: 'CIO-led review for self-hosting buyers; security brief before demo.' },
  { name: 'Partner-led', text: 'Integrator introduces APEX inside an existing client relationship.' },
]

// ---------------------------------------------------------------- demonstrations ----
export const DEMOS = [
  { persona: 'A', length: '15 min', show: 'Dashboard, one playbook becoming a verified certificate, analytics', avoid: 'Settings and admin depth', proof: 'Public certificate verification link', close: 'Agree a pilot sponsor' },
  { persona: 'B', length: '30 min', show: 'Team usage, compliance view, recertification after a playbook change', avoid: 'Architecture detail', proof: 'Compliance CSV export', close: 'Nominate pilot teams' },
  { persona: 'C', length: '45 min', show: 'Playbook import → AI draft → quality flags → approval → quiz; meeting → action items', avoid: 'Pricing', proof: 'Coverage map back to source chapters', close: 'Champion the pilot' },
  { persona: 'D', length: '45 min', show: 'Self-hosted install, identity and roles, audit log, proxied storage, AI budgets', avoid: 'Unbuilt features as if live', proof: 'Security controls walkthrough', close: 'Technical sign-off' },
  { persona: 'E', length: '10 min', show: 'One sign-in, search, deck viewer, offline, a short lesson', avoid: 'Admin screens', proof: 'Find a deck in seconds', close: 'Join the pilot team' },
  { persona: 'F', length: '30 min', show: 'Install, demo modes, content conversion workflow', avoid: 'Customer names', proof: 'Repeatable implementation steps', close: 'Partner agreement next steps' },
]
export const DEMO_RULES = [
  'Use demo modes or a clean environment; label sample data as illustrative.',
  'Show only LIVE features as working; present roadmap items as roadmap.',
  'Open with the persona’s problem; end with one clear next step.',
  'Never quote customer results or ROI until a pilot report exists.',
]

// ---------------------------------------------------------------- buying decision ----
export const BUYING_STAGES = [
  { stage: 'Need recognised', who: 'A, B', objection: '“Is this a priority now?”', approval: 'Sponsor agrees to explore' },
  { stage: 'Discovery & requirements', who: 'B, C', objection: '“Does it fit how we work?”', approval: 'Requirements agreed' },
  { stage: 'Solution evaluation', who: 'B, C, E', objection: '“Will people use it?”', approval: 'Demo accepted' },
  { stage: 'Technical & security review', who: 'D, Governance', objection: '“SSO, hosting, data protection?”', approval: 'Technical sign-off' },
  { stage: 'Pilot', who: 'C, E, D', objection: '“What if it fails?”', approval: 'Pilot success criteria met' },
  { stage: 'Business case', who: 'A, B', objection: '“What is the return?”', approval: 'Budget allocated' },
  { stage: 'Procurement & legal', who: 'Governance', objection: '“Terms, liability, DPA?”', approval: 'Contract approved' },
  { stage: 'Purchase decision', who: 'A', objection: '“Now or next year?”', approval: 'Signature' },
]
