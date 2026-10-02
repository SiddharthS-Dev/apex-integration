// Minimal structured logger. Never pass tokens or secrets in `fields`; known secret keys are redacted anyway.
const REDACT = /token|secret|password|authorization|cookie/i;

function clean(fields) {
  if (!fields) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = REDACT.test(k) ? '[redacted]' : v;
  return out;
}

function write(level, msg, fields) {
  const line = { t: new Date().toISOString(), level, msg, ...clean(fields) };
  const text = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(text);
  else console.log(text);
}

export const log = {
  debug: (msg, f) => { if (process.env.LOG_LEVEL === 'debug') write('debug', msg, f); },
  info: (msg, f) => write('info', msg, f),
  warn: (msg, f) => write('warn', msg, f),
  error: (msg, f) => write('error', msg, f),
};
