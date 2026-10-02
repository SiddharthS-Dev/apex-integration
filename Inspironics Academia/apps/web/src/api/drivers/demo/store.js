import { ENTITY_NAMES } from '@academy/shared';
import { buildSeed } from '@/api/drivers/demo/seed';

// In-memory demo database, persisted to localStorage when available. Every storage access is guarded:
// private windows, blocked storage or a full quota simply fall back to memory-only.

const STORAGE_KEY = 'iea-demo-db-v1';
let state = null;

function readStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.version === 1 && parsed.tables ? parsed : null;
  } catch {
    return null;
  }
}

export function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable or full — the demo keeps working in memory.
  }
}

export function db() {
  if (!state) {
    state = readStorage() || buildSeed();
    for (const name of ENTITY_NAMES) state.tables[name] ||= [];
    state.logins ||= [];
    state.resets ||= {};
    persist();
  }
  return state;
}

export function resetDb() {
  state = buildSeed();
  persist();
  return state;
}

export const table = (name) => {
  const s = db();
  s.tables[name] ||= [];
  return s.tables[name];
};

export const replaceTable = (name, rows) => {
  db().tables[name] = rows;
};

export const currentUserRow = () => {
  const s = db();
  const u = s.sessionUserId ? s.users.find((x) => x.id === s.sessionUserId) : null;
  return u && !u.disabled ? u : null;
};

// Public user shape — never exposes the demo password fields.
export function publicUser(u) {
  if (!u) return null;
  const { password: _pw, any_password: _any, ...rest } = u;
  return { ...rest };
}

export const currentUser = () => publicUser(currentUserRow());
