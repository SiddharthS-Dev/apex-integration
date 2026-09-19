import { DOMAINS, DOMAIN_NAMES } from '@/lib/domains';
import { hashSeed } from '@/lib/utils';
import catalog from './catalog.json';

/**
 * Fallback catalog, used only if catalog.json is empty or missing.
 *
 * The real library lives in catalog.json — a committed snapshot of the Base44
 * app's Presentation entity, refreshed with `npm run sync:catalog`. These 32
 * hand-written decks predate that and are kept as a last resort so the app
 * still has something to show if the snapshot is ever lost.
 */
const DEMO_CATALOG = [
  ['Engineering', 'Architecture', 'Event-Driven Architecture at Inspironics', 'How we moved from a request/response monolith to an event backbone that scales per team.', ['architecture', 'events', 'kafka', 'scaling']],
  ['Engineering', 'Architecture', 'Designing Multi-Tenant Data Isolation', 'Row-level security, schema-per-tenant and the trade-offs we measured in production.', ['multi-tenant', 'postgres', 'security']],
  ['Engineering', 'Backend', 'API Versioning Without Breaking Clients', 'A practical contract-first approach to evolving public APIs for years, not months.', ['api', 'versioning', 'contracts']],
  ['Engineering', 'Backend', 'Idempotency and Retries in Payment Flows', 'Making every write safe to repeat when the network is not on your side.', ['payments', 'idempotency', 'reliability']],
  ['Engineering', 'Frontend', 'Rendering 10k Rows Without Dropping Frames', 'Virtualisation, memoisation and the profiler workflow behind our fastest table yet.', ['react', 'performance', 'virtualisation']],
  ['Engineering', 'Frontend', 'A Design System That Survives Redesigns', 'Tokens, primitives and the governance model that keeps forty engineers in step.', ['design-system', 'tokens', 'tailwind']],
  ['Engineering', 'DevOps', 'Zero-Downtime Deploys on Kubernetes', 'Rolling strategies, readiness gates and the rollback drill we run every Friday.', ['kubernetes', 'deploys', 'sre']],
  ['Engineering', 'DevOps', 'Observability From Dashboards to Answers', 'Traces, logs and metrics wired so an on-call engineer finds the cause in five minutes.', ['observability', 'tracing', 'oncall']],
  ['Engineering', 'AI', 'Retrieval-Augmented Generation in Practice', 'Chunking, embeddings, re-ranking and evaluation for enterprise knowledge search.', ['rag', 'llm', 'embeddings']],
  ['Products', 'FleetExplorer', 'FleetExplorer 3.0 Product Vision', 'The next generation of fleet intelligence: live telemetry, predictive maintenance, ROI views.', ['fleet', 'telemetry', 'roadmap']],
  ['Products', 'FleetExplorer', 'Telemetry Ingestion at Two Million Events a Minute', 'Edge buffering, batching and the cost curve that made real-time affordable.', ['telemetry', 'ingestion', 'iot']],
  ['Products', 'Discipline Engine', 'Discipline Engine Rules That Explain Themselves', 'Turning an opaque scoring engine into auditable, human-readable decisions.', ['rules', 'explainability', 'audit']],
  ['Products', 'Insight Flow', 'Insight Flow Analytics Walkthrough', 'Dashboards, alerting and the embedded analytics SDK for customer-facing reports.', ['analytics', 'dashboards', 'sdk']],
  ['Products', 'SlidesVault', 'SlidesVault Launch Deck', 'Why a presentation knowledge hub, what it replaces and the first ninety days of adoption.', ['launch', 'knowledge', 'adoption']],
  ['Products', 'ESG', 'ESG Reporting Module Overview', 'Scope 1 to 3 accounting, evidence trails and one-click regulator exports.', ['esg', 'reporting', 'compliance']],
  ['Products', 'CK', 'CK Platform Integration Guide', 'Connectors, webhooks and the data contract every CK integration must honour.', ['integration', 'webhooks', 'platform']],
  ['Business', 'Operations', 'Operational Excellence Playbook 2026', 'The metrics, rituals and escalation paths that run the business week to week.', ['operations', 'kpi', 'playbook']],
  ['Business', 'Sales', 'Enterprise Sales Motion From Discovery to Close', 'Qualification framework, mutual action plans and the objections that actually matter.', ['sales', 'enterprise', 'qualification']],
  ['Business', 'Sales', 'Competitive Battlecards Q3', 'Positioning against the three competitors we meet in eighty percent of deals.', ['competitive', 'positioning', 'battlecard']],
  ['Business', 'Marketing', 'Brand Refresh and Messaging Architecture', 'One story, five audiences: the messaging house behind the new site and campaigns.', ['brand', 'messaging', 'campaign']],
  ['Business', 'Finance', 'Unit Economics and the Path to Margin', 'Gross margin per customer, cost to serve and where the leverage actually sits.', ['finance', 'unit-economics', 'margin']],
  ['Business', 'Customer Success', 'Reducing Churn With Health Scores', 'The signals that predicted every churn last year, and the plays that reversed them.', ['churn', 'health-score', 'retention']],
  ['Human Resources', 'Onboarding', 'Your First 30 Days at Inspironics', 'Everything a new joiner needs: systems, buddies, rituals and the thirty-day checkpoint.', ['onboarding', 'new-hire', 'culture']],
  ['Human Resources', 'Policies', 'Remote and Hybrid Work Policy', 'Where we work, how we overlap and what the company pays for.', ['policy', 'remote', 'hybrid']],
  ['Human Resources', 'Training', 'Security Awareness Training 2026', 'Phishing, credential hygiene and the reporting path when something feels wrong.', ['security', 'training', 'phishing']],
  ['Human Resources', 'Performance', 'Career Ladders and Promotion Criteria', 'Levels, expectations and evidence: how promotion decisions are actually made.', ['career', 'levels', 'promotion']],
  ['Human Resources', 'Recruitment', 'Structured Interviewing Guide', 'Scorecards, calibrated questions and removing noise from hiring decisions.', ['hiring', 'interviews', 'scorecard']],
  ['Research & Innovation', 'AI Research', 'Agentic Workflows What Works in 2026', 'Planning, tool use and evaluation harnesses from twelve internal experiments.', ['agents', 'llm', 'evaluation']],
  ['Research & Innovation', 'IoT', 'Edge Inference on Constrained Devices', 'Quantisation, scheduling and the battery budget that decides the architecture.', ['edge', 'iot', 'inference']],
  ['Research & Innovation', 'Knowledge Base', 'Building an Internal Knowledge Graph', 'Entities, extraction pipelines and search that answers instead of listing.', ['knowledge-graph', 'search', 'nlp']],
  ['Research & Innovation', 'Sustainability', 'Carbon-Aware Compute Scheduling', 'Shifting batch workloads to greener hours without missing an SLA.', ['sustainability', 'carbon', 'scheduling']],
  ['Research & Innovation', 'Future Concepts', 'Ambient Interfaces Beyond the Dashboard', 'Concepts for software that surfaces insight before anyone opens a report.', ['concepts', 'ux', 'future']],
];

const FILE_TYPES = ['pdf', 'pdf', 'pdf', 'pptx', 'pptx', 'html'];

const AUTHORS = [
  'A. Raman', 'S. Kapoor', 'M. Lindqvist', 'J. Okafor', 'P. Nascimento',
  'L. Chen', 'D. Moreau', 'R. Fitzgerald', 'N. Haddad', 'T. Brennan',
];

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/**
 * Normalises one Base44 record for the local backend.
 *
 * Missing values are left missing rather than invented: the real library has no
 * author and no slide count on most rows, and the UI already renders those as
 * '—' or hides them. Filling them with plausible-looking values would attribute
 * real documents to people who did not write them.
 */
function fromBase44(record) {
  return {
    ...record,
    tags: record.tags || [],
    keywords: record.keywords || [],
    learning_objectives: record.learning_objectives || [],
    view_count: record.view_count || 0,
    trend_score: record.trend_score || 0,
    slide_count: record.slide_count || 0,
    sync_status: record.sync_status || 'synced',
    status: record.status || 'active',
  };
}

/** How many presentations the local backend seeds, and from where. */
export const CATALOG_SOURCE = Array.isArray(catalog) && catalog.length ? 'base44' : 'demo';
export const CATALOG_SIZE = CATALOG_SOURCE === 'base44' ? catalog.length : DEMO_CATALOG.length;

export function buildSeedPresentations() {
  if (CATALOG_SOURCE === 'base44') return catalog.map(fromBase44);
  return buildDemoPresentations();
}

function buildDemoPresentations() {
  return DEMO_CATALOG.map(([domain, sub, title, summary, tags], i) => {
    const seed = hashSeed(title);
    const fileType = FILE_TYPES[seed % FILE_TYPES.length];
    const slideCount = 12 + (seed % 34);
    const created = daysAgo(2 + (((seed % 180) + i) % 200));
    const modified = daysAgo(1 + (seed % 60));
    const views = 4 + (seed % 940);

    return {
      id: `seed-${String(i + 1).padStart(3, '0')}`,
      title,
      description: summary,
      dropbox_id: `id:seed${seed.toString(36)}`,
      dropbox_path: `/Apps/SlidesVault/${domain}/${title.replace(/[^\w\s-]/g, '')}.${fileType}`,
      dropbox_rev: seed.toString(16).slice(0, 9),
      file_url: '',
      thumbnail_url: '',
      file_type: fileType,
      file_size: 400000 + (seed % 22000000),
      slide_count: slideCount,
      author: AUTHORS[seed % AUTHORS.length],
      primary_domain: domain,
      sub_domain: sub,
      category: sub,
      tags,
      keywords: [
        ...tags,
        domain.toLowerCase(),
        sub.toLowerCase(),
        ...title.toLowerCase().split(/\s+/).slice(0, 3),
      ],
      learning_objectives: [
        `Explain the core ideas behind ${title.toLowerCase()}.`,
        `Apply the ${sub} practices described here to your own team.`,
        'Identify the trade-offs and the failure modes worth watching for.',
      ],
      ai_summary: `${summary} Presented by the ${sub} group within ${domain}, this deck walks through the context, the decisions taken and the measured outcome.`,
      ai_confidence: Math.min(0.99, 0.72 + (seed % 27) / 100),
      view_count: views,
      trend_score: Math.round((views / 10) * (1 + (seed % 9) / 10)),
      modified_date: modified,
      last_synced: daysAgo(0),
      sync_status: 'synced',
      status: 'active',
      created_date: created,
      updated_date: modified,
      created_by_id: 'system',
    };
  });
}

export function buildSeedAnalytics(presentations) {
  const now = Date.now();
  return presentations.map((p) => {
    const seed = hashSeed(p.id + p.title);
    const daily = [];
    let remaining = p.view_count;

    for (let d = 59; d >= 0; d -= 1) {
      if (remaining <= 0) break;
      const date = new Date(now - d * 86400000).toISOString().slice(0, 10);
      // Recent days carry more weight so the trending sections look alive.
      const weight = 1 + (60 - d) / 40;
      const count = Math.round(((seed >> (d % 12)) % 4) * weight) % 9;
      if (count > 0) {
        daily.push({ date, count: Math.min(count, remaining) });
        remaining -= count;
      }
    }

    const online = Math.round(p.view_count * 0.78);
    return {
      id: `an-${p.id}`,
      presentation_id: p.id,
      presentation_title: p.title,
      total_views: p.view_count,
      unique_views: Math.max(1, Math.round(p.view_count * 0.62)),
      viewer_ids: [],
      online_views: online,
      offline_views: p.view_count - online,
      avg_reading_time: 120 + (seed % 900),
      completion_pct: 30 + (seed % 65),
      bookmarks: seed % 14,
      favorites: seed % 9,
      last_viewed_date: new Date(now - (seed % 9) * 86400000).toISOString(),
      last_viewed_by: 'demo-user',
      last_viewed_by_name: AUTHORS[seed % AUTHORS.length],
      trend_score: p.trend_score,
      daily_breakdown: daily,
      created_date: p.created_date,
      updated_date: p.modified_date,
    };
  });
}

export function buildSeedUsers() {
  const names = [
    ['Avery Raman', 'avery.raman@inspironics.net', 'admin'],
    ['Sana Kapoor', 'sana.kapoor@inspironics.net', 'user'],
    ['Mikael Lindqvist', 'mikael.lindqvist@inspironics.net', 'user'],
    ['Joy Okafor', 'joy.okafor@inspironics.net', 'user'],
    ['Pedro Nascimento', 'pedro.nascimento@inspironics.net', 'user'],
    ['Li Chen', 'li.chen@inspironics.net', 'user'],
    ['Delphine Moreau', 'delphine.moreau@inspironics.net', 'user'],
    ['Ronan Fitzgerald', 'ronan.fitzgerald@inspironics.net', 'user'],
  ];
  return names.map(([full_name, email, role], i) => ({
    id: `user-${i + 1}`,
    full_name,
    email,
    role,
    created_date: daysAgo(210 - i * 21),
    last_login: daysAgo(i % 5),
    last_active: new Date(Date.now() - (i % 4) * 3600000).toISOString(),
  }));
}

export const SEED_DOMAIN_NAMES = DOMAIN_NAMES;
export const SEED_DOMAIN_META = DOMAINS;
