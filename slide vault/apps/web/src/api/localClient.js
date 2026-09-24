/**
 * Local backend used when no Base44 app id is configured.
 *
 * It implements the same surface the app consumes from the Base44 SDK
 * (entities, auth, functions, integrations) on top of localStorage, so the
 * whole product — search, analytics, RBAC, offline downloads, the copilot —
 * is explorable without any cloud credentials. Point VITE_BASE44_APP_ID at a
 * real app and every call in this file is replaced by the real SDK.
 */
import { buildSeedPresentations, buildSeedAnalytics, buildSeedUsers } from './seed';
import { DOMAIN_NAMES, DOMAINS } from '@/lib/domains';

const NS = 'slidesvault';
const DEMO_PASSWORD = 'slidesvault';

/* ------------------------------------------------------------------ store */

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(`${NS}:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(`${NS}:${key}`, JSON.stringify(value));
  } catch {
    /* quota or private mode — the in-memory copy still works for this session */
  }
  return value;
}

const memory = new Map();

function table(name, seedFn) {
  if (!memory.has(name)) {
    const existing = read(name, null);
    memory.set(name, existing ?? write(name, seedFn ? seedFn() : []));
  }
  return memory.get(name);
}

function persist(name) {
  write(name, memory.get(name) || []);
}

function uid(prefix = 'rec') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function matches(record, query) {
  return Object.entries(query || {}).every(([key, want]) => {
    const got = record[key];
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      // Minimal mongo-ish operator support, mirroring what the SDK accepts.
      if ('$in' in want) return want.$in.includes(got);
      if ('$ne' in want) return got !== want.$ne;
      if ('$gt' in want) return got > want.$gt;
      if ('$gte' in want) return got >= want.$gte;
      if ('$lt' in want) return got < want.$lt;
      if ('$lte' in want) return got <= want.$lte;
      if ('$contains' in want) return Array.isArray(got) && got.includes(want.$contains);
      return false;
    }
    if (Array.isArray(got)) return got.includes(want);
    return got === want;
  });
}

function sortRecords(records, sort) {
  if (!sort) return records;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...records].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  });
}

const latency = () => new Promise((r) => setTimeout(r, 40 + Math.random() * 90));

function entity(name, seedFn, idPrefix) {
  return {
    async list(sort, limit, skip = 0) {
      await latency();
      const rows = sortRecords(table(name, seedFn), sort).slice(skip);
      return limit ? rows.slice(0, limit) : rows;
    },
    async filter(query, sort, limit, skip = 0) {
      await latency();
      const rows = sortRecords(
        table(name, seedFn).filter((r) => matches(r, query)),
        sort
      ).slice(skip);
      return limit ? rows.slice(0, limit) : rows;
    },
    async get(id) {
      await latency();
      const found = table(name, seedFn).find((r) => r.id === id);
      if (!found) throw new Error(`${name} ${id} not found`);
      return found;
    },
    async create(data) {
      await latency();
      const now = new Date().toISOString();
      const record = {
        id: uid(idPrefix || name.toLowerCase()),
        created_date: now,
        updated_date: now,
        created_by_id: currentUserId(),
        ...data,
      };
      table(name, seedFn).unshift(record);
      persist(name);
      return record;
    },
    async bulkCreate(rows) {
      const out = [];
      for (const row of rows) out.push(await this.create(row));
      return out;
    },
    async update(id, data) {
      await latency();
      const rows = table(name, seedFn);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error(`${name} ${id} not found`);
      rows[idx] = { ...rows[idx], ...data, updated_date: new Date().toISOString() };
      persist(name);
      return rows[idx];
    },
    async delete(id) {
      await latency();
      const rows = table(name, seedFn);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx !== -1) {
        rows.splice(idx, 1);
        persist(name);
      }
      return { id, deleted: true };
    },
  };
}

/* ------------------------------------------------------------------- auth */

function currentUserId() {
  return read('session', null)?.user_id || null;
}

function seedPresentations() {
  return buildSeedPresentations();
}

function seedAnalytics() {
  return buildSeedAnalytics(table('Presentation', seedPresentations));
}

const Presentation = entity('Presentation', seedPresentations, 'pres');
const PresentationAnalytics = entity('PresentationAnalytics', seedAnalytics, 'an');
const DropboxConfig = entity('DropboxConfig', () => [], 'dbx');
const SyncLog = entity('SyncLog', () => [], 'sync');
const LoginHistory = entity('LoginHistory', () => [], 'login');

const userEntity = entity('User', buildSeedUsers, 'user');

function findUserByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  return table('User', buildSeedUsers).find((u) => u.email.toLowerCase() === target) || null;
}

function setCredential(email, password) {
  const store = read('credentials', {});
  store[email.toLowerCase()] = password;
  write('credentials', store);
  memory.set('credentials', store);
}

function checkCredential(email, password) {
  const store = read('credentials', {});
  const known = store[String(email).toLowerCase()];
  // Seeded accounts all share the demo password until one is set explicitly.
  return known ? known === password : password === DEMO_PASSWORD;
}

const auth = {
  async me() {
    await latency();
    const session = read('session', null);
    if (!session) throw new Error('Not authenticated');
    const user = table('User', buildSeedUsers).find((u) => u.id === session.user_id);
    if (!user) throw new Error('Not authenticated');
    return user;
  },

  isAuthenticated() {
    return Boolean(read('session', null));
  },

  async login({ email, password }) {
    await latency();
    const user = findUserByEmail(email);
    if (!user) throw new Error('No account found for that email address.');
    if (!checkCredential(email, password)) throw new Error('Incorrect email or password.');
    write('session', { user_id: user.id, started: new Date().toISOString() });
    await userEntity.update(user.id, { last_login: new Date().toISOString() });
    return user;
  },

  /** The demo backend simulates both methods, so it offers both. */
  async capabilities() {
    return { password: true, google: true };
  },

  async loginWithGoogle() {
    await latency();
    // Demo shortcut: signs in as the seeded admin.
    const user = findUserByEmail('avery.raman@inspironics.net') || table('User', buildSeedUsers)[0];
    write('session', { user_id: user.id, started: new Date().toISOString() });
    return user;
  },

  async register({ email, password, full_name }) {
    await latency();
    if (findUserByEmail(email)) throw new Error('An account with that email already exists.');
    const users = table('User', buildSeedUsers);
    const user = {
      id: uid('user'),
      full_name: full_name || String(email).split('@')[0].replace(/[._]/g, ' '),
      email,
      role: users.length === 0 ? 'admin' : 'user',
      created_date: new Date().toISOString(),
    };
    users.push(user);
    persist('User');
    setCredential(email, password);
    write('pending_otp', { email, code: '000000' });
    return { email, otp_required: true };
  },

  async sendOtp({ email }) {
    await latency();
    write('pending_otp', { email, code: '000000' });
    return { sent: true };
  },

  async verifyOtp({ email, otp }) {
    await latency();
    const pending = read('pending_otp', null);
    if (!pending || pending.email !== email) throw new Error('No verification in progress.');
    if (otp !== pending.code) throw new Error('That code is not correct. Demo code is 000000.');
    const user = findUserByEmail(email);
    write('session', { user_id: user.id, started: new Date().toISOString() });
    write('pending_otp', null);
    return user;
  },

  async resetPasswordRequest({ email }) {
    await latency();
    const user = findUserByEmail(email);
    if (user) write('reset_token', { email, token: 'demo-reset-token' });
    return { ok: true };
  },

  async resetPassword({ token, password }) {
    await latency();
    const pending = read('reset_token', null);
    if (!pending || pending.token !== token) throw new Error('This reset link is invalid or expired.');
    setCredential(pending.email, password);
    write('reset_token', null);
    return { ok: true };
  },

  async updateMyUserData(data) {
    const me = await auth.me();
    return userEntity.update(me.id, data);
  },

  async logout() {
    write('session', null);
    return { ok: true };
  },
};

/* -------------------------------------------------------------- functions */

async function requireUser() {
  return auth.me();
}

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'admin') {
    const err = new Error('Admin role required.');
    err.status = 403;
    throw err;
  }
  return user;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function viewsInLastDays(breakdown = [], days) {
  const cutoff = Date.now() - days * 86400000;
  return breakdown
    .filter((d) => new Date(d.date).getTime() >= cutoff)
    .reduce((sum, d) => sum + (d.count || 0), 0);
}

/** Renders a readable placeholder PDF so the viewer works without Dropbox. */
async function renderLocalPdf(presentation) {
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [960, 540] });
  const meta = DOMAINS[presentation.primary_domain] || { hex: '#4f46e5' };
  const rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r, g, b] = rgb(meta.hex);

  const slideBase = (index, total) => {
    doc.setFillColor(12, 14, 28);
    doc.rect(0, 0, 960, 540, 'F');
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, 960, 8, 'F');
    doc.setTextColor(140, 146, 170);
    doc.setFontSize(10);
    doc.text('Inspironics SlidesVault', 48, 512);
    doc.text(`${index} / ${total}`, 890, 512);
  };

  const total = Math.max(4, Math.min(presentation.slide_count || 12, 24));

  // Title slide
  slideBase(1, total);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(40);
  doc.text(doc.splitTextToSize(presentation.title, 820), 64, 200);
  doc.setFontSize(16);
  doc.setTextColor(r, g, b);
  doc.text(`${presentation.primary_domain} · ${presentation.sub_domain || ''}`, 64, 270);
  doc.setTextColor(180, 186, 210);
  doc.setFontSize(13);
  doc.text(doc.splitTextToSize(presentation.ai_summary || presentation.description || '', 800), 64, 310);
  doc.setFontSize(11);
  doc.setTextColor(120, 126, 150);
  doc.text(`${presentation.author || 'Inspironics'} · ${presentation.file_type?.toUpperCase()}`, 64, 440);

  // Agenda
  doc.addPage();
  slideBase(2, total);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(30);
  doc.text('Learning objectives', 64, 130);
  doc.setFontSize(16);
  doc.setTextColor(200, 206, 230);
  (presentation.learning_objectives || []).forEach((line, i) => {
    doc.text(doc.splitTextToSize(`${i + 1}.  ${line}`, 800), 64, 210 + i * 60);
  });

  // Body slides
  for (let i = 3; i <= total; i += 1) {
    doc.addPage();
    slideBase(i, total);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.text(`${presentation.sub_domain || presentation.primary_domain} — section ${i - 2}`, 64, 130);
    doc.setFontSize(14);
    doc.setTextColor(170, 176, 200);
    const tag = (presentation.tags || [])[(i - 3) % Math.max(1, (presentation.tags || []).length)];
    doc.text(
      doc.splitTextToSize(
        `This slide stands in for page ${i} of the synced file. Topic focus: ${tag || presentation.category || 'overview'}. ` +
          'Connect a Dropbox account in Dropbox Settings to stream the real document here.',
        800
      ),
      64,
      200
    );
  }

  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}

const streamCache = new Map();

const functions = {
  async getPresentationStream({ presentation_id }) {
    const presentation = await Presentation.get(presentation_id);
    if (presentation.file_url) {
      return { data: { url: presentation.file_url, dropbox_rev: presentation.dropbox_rev, preview: false } };
    }
    if (!streamCache.has(presentation_id)) {
      streamCache.set(presentation_id, await renderLocalPdf(presentation));
    }
    return {
      data: {
        url: streamCache.get(presentation_id),
        dropbox_rev: presentation.dropbox_rev,
        preview: true,
        local: true,
      },
    };
  },

  async trackView({ presentation_id, source = 'online', reading_time_secs = 0, completion_pct = 0 }) {
    const user = await requireUser();
    const presentation = await Presentation.get(presentation_id);
    const [existing] = await PresentationAnalytics.filter({ presentation_id });

    const record = existing || (await PresentationAnalytics.create({
      presentation_id,
      presentation_title: presentation.title,
      total_views: 0,
      unique_views: 0,
      viewer_ids: [],
      online_views: 0,
      offline_views: 0,
      avg_reading_time: 0,
      completion_pct: 0,
      bookmarks: 0,
      favorites: 0,
      trend_score: 0,
      daily_breakdown: [],
    }));

    const viewers = new Set(record.viewer_ids || []);
    const isNewViewer = !viewers.has(user.id);
    viewers.add(user.id);

    const breakdown = [...(record.daily_breakdown || [])];
    const key = todayKey();
    const todayEntry = breakdown.find((d) => d.date === key);
    if (todayEntry) todayEntry.count += 1;
    else breakdown.push({ date: key, count: 1 });
    const cutoff = Date.now() - 60 * 86400000;
    const trimmed = breakdown
      .filter((d) => new Date(d.date).getTime() >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalViews = (record.total_views || 0) + 1;
    const recent = viewsInLastDays(trimmed, 7);
    const previous = viewsInLastDays(trimmed, 14) - recent;
    const growth = previous > 0 ? (recent - previous) / previous : recent > 0 ? 1 : 0;

    const avgReading = reading_time_secs > 0
      ? Math.round(((record.avg_reading_time || 0) * (totalViews - 1) + reading_time_secs) / totalViews)
      : record.avg_reading_time || 0;
    const avgCompletion = completion_pct > 0
      ? Math.round(((record.completion_pct || 0) * (totalViews - 1) + completion_pct) / totalViews)
      : record.completion_pct || 0;

    const trendScore = Math.round(recent * 2 + growth * 30 + avgReading / 60);

    await PresentationAnalytics.update(record.id, {
      total_views: totalViews,
      unique_views: (record.unique_views || 0) + (isNewViewer ? 1 : 0),
      viewer_ids: [...viewers],
      online_views: (record.online_views || 0) + (source === 'offline' ? 0 : 1),
      offline_views: (record.offline_views || 0) + (source === 'offline' ? 1 : 0),
      avg_reading_time: avgReading,
      completion_pct: avgCompletion,
      last_viewed_date: new Date().toISOString(),
      last_viewed_by: user.id,
      last_viewed_by_name: user.full_name,
      trend_score: trendScore,
      daily_breakdown: trimmed,
    });

    await Presentation.update(presentation_id, {
      view_count: (presentation.view_count || 0) + 1,
      trend_score: trendScore,
    });

    return { data: { ok: true, total_views: totalViews, trend_score: trendScore } };
  },

  async recordLogin() {
    const user = await requireUser();
    const now = new Date().toISOString();
    await LoginHistory.create({
      user_id: user.id,
      user_name: user.full_name,
      email: user.email,
      login_at: now,
      status: 'success',
    });
    await userEntity.update(user.id, { last_login: now, last_active: now });
    return { data: { ok: true } };
  },

  async dropboxAuth(payload = {}) {
    const { action = 'status', root_folder } = payload;
    await requireAdmin();
    const [config] = await DropboxConfig.list('-created_date', 1);

    const sanitized = (c) => (c ? {
      connection_status: c.connection_status,
      sync_status: c.sync_status,
      account_id: c.account_id,
      connected_account_name: c.connected_account_name,
      connected_account_email: c.connected_account_email,
      root_folder: c.root_folder,
      last_sync: c.last_sync,
      last_token_refresh: c.last_token_refresh,
      last_error: c.last_error,
    } : { connection_status: 'disconnected', sync_status: 'idle', root_folder: '/Apps/SlidesVault' });

    switch (action) {
      case 'getAuthUrl':
        return {
          data: {
            error:
              'Dropbox OAuth needs a deployed backend. Configure VITE_BASE44_APP_ID and deploy base44/functions/dropboxAuth, then register the redirect URI shown above.',
          },
        };
      case 'test':
        return { data: { ok: false, error: 'No Dropbox connection configured in local mode.' } };
      case 'list_folders':
        return {
          data: {
            entries: [
              { name: 'Apps', path_lower: '/apps' },
              { name: 'SlidesVault', path_lower: '/apps/slidesvault' },
              { name: 'Team Decks', path_lower: '/team decks' },
            ],
          },
        };
      case 'set_root_folder': {
        const next = config
          ? await DropboxConfig.update(config.id, { root_folder })
          : await DropboxConfig.create({
              connection_status: 'disconnected',
              sync_status: 'idle',
              root_folder,
            });
        return { data: sanitized(next) };
      }
      case 'revoke':
        if (config) await DropboxConfig.update(config.id, { connection_status: 'disconnected', refresh_token: '' });
        return { data: { ok: true } };
      default:
        return { data: sanitized(config) };
    }
  },

  async syncDropbox({ trigger = 'manual' } = {}) {
    await requireAdmin();
    const started = new Date().toISOString();
    const presentations = await Presentation.filter({ status: 'active' });
    const log = await SyncLog.create({
      started_at: started,
      status: 'success',
      trigger,
      new_count: 0,
      updated_count: 0,
      deleted_count: 0,
      total_files: presentations.length,
      completed_at: new Date().toISOString(),
      details: JSON.stringify({
        root_folder: '/Apps/SlidesVault',
        discovered: presentations.length,
        indexed: presentations.length,
        remaining: 0,
        errors: ['Local mode: no Dropbox connection, catalog left unchanged.'],
      }),
    });
    const [config] = await DropboxConfig.list('-created_date', 1);
    if (config) {
      await DropboxConfig.update(config.id, { sync_status: 'success', last_sync: new Date().toISOString() });
    }
    return {
      data: {
        status: 'success',
        root_folder: '/Apps/SlidesVault',
        discovered: presentations.length,
        indexed: presentations.length,
        new: 0,
        updated: 0,
        deleted: 0,
        remaining: 0,
        errors: ['Local mode: connect Dropbox from a deployed backend to run a real sync.'],
        log_id: log.id,
      },
    };
  },

  async renameUntitledPresentations() {
    await requireAdmin();
    return { data: { renamed: [], dry_run: true, note: 'Local mode: nothing to rename.' } };
  },

  async getDownloadLinks() {
    await requireAdmin();
    return { data: { links: [], note: 'Local mode: temporary Dropbox links require a live connection.' } };
  },
};

/* ----------------------------------------------------------- integrations */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'what',
  'how', 'do', 'i', 'me', 'my', 'we', 'you', 'about', 'with', 'show', 'find', 'any',
  'some', 'give', 'please', 'can', 'there', 'have', 'has', 'best', 'good',
]);

function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Keyword-scored stand-in for the hosted LLM, used by the copilot locally. */
function localCopilot({ question, catalog = [] }) {
  const terms = tokenize(question);
  const scored = catalog
    .map((item, index) => {
      const haystack = `${item.title} ${item.primary_domain} ${item.sub_domain} ${(item.tags || []).join(' ')} ${item.ai_summary || ''}`.toLowerCase();
      let score = 0;
      terms.forEach((t) => {
        if (item.title.toLowerCase().includes(t)) score += 4;
        if ((item.tags || []).some((tag) => tag.toLowerCase().includes(t))) score += 3;
        if (String(item.primary_domain).toLowerCase().includes(t)) score += 3;
        if (String(item.sub_domain).toLowerCase().includes(t)) score += 2;
        if (haystack.includes(t)) score += 1;
      });
      return { index: index + 1, item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.item.view_count || 0) - (a.item.view_count || 0))
    .slice(0, 5);

  if (scored.length === 0) {
    const domainList = DOMAIN_NAMES.map((d) => `**${d}**`).join(', ');
    const popular = [...catalog].sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, 3);
    return {
      reply:
        `I could not find a close match for that in the library. The catalog covers ${domainList}. ` +
        'Here are the decks people open most — or try a domain name, a product name or a topic like "kubernetes".',
      picks: popular.map((p) => catalog.indexOf(p) + 1),
    };
  }

  const top = scored[0].item;
  const others = scored.slice(1);
  const reply =
    `**${top.title}** looks like the closest match — it sits under ${top.primary_domain} › ${top.sub_domain}. ` +
    `${top.ai_summary ? top.ai_summary.split('.')[0] + '.' : ''}` +
    (others.length
      ? `\n\nAlso worth a look:\n${others.map((o) => `- **${o.item.title}** — ${o.item.primary_domain} › ${o.item.sub_domain}`).join('\n')}`
      : '') +
    '\n\nTap any card below to open it.';

  return { reply, picks: scored.map((s) => s.index) };
}

const integrations = {
  Core: {
    async InvokeLLM({ prompt, response_json_schema, __local } = {}) {
      await latency();
      if (__local?.kind === 'copilot') {
        return localCopilot(__local);
      }
      if (response_json_schema) return {};
      return `Local mode has no language model configured. Prompt received: ${String(prompt).slice(0, 120)}…`;
    },
    async UploadFile({ file }) {
      await latency();
      return { file_url: URL.createObjectURL(file), file_name: file?.name };
    },
  },
};

export const localClient = {
  mode: 'local',
  auth,
  entities: {
    Presentation,
    PresentationAnalytics,
    DropboxConfig,
    SyncLog,
    LoginHistory,
    User: {
      ...userEntity,
      me: auth.me,
      updateMyUserData: auth.updateMyUserData,
      login: auth.login,
      logout: auth.logout,
    },
  },
  functions,
  integrations,
};

export const DEMO_CREDENTIALS = {
  admin: { email: 'avery.raman@inspironics.net', password: DEMO_PASSWORD },
  user: { email: 'sana.kapoor@inspironics.net', password: DEMO_PASSWORD },
};

export function resetLocalData() {
  ['Presentation', 'PresentationAnalytics', 'DropboxConfig', 'SyncLog', 'LoginHistory', 'User', 'session'].forEach(
    (k) => {
      localStorage.removeItem(`${NS}:${k}`);
      memory.delete(k);
    }
  );
}
