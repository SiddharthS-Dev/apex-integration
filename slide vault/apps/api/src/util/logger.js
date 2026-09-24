/**
 * Structured JSON logging with mandatory secret redaction.
 *
 * Every field passed as context is run through redact() before it is
 * serialised, so a caller cannot leak a token by logging a raw request object.
 */
import { redact, redactText } from './redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger({ level = 'info', name = 'slidesvault', stream = process.stdout } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (levelName, message, context) => {
    if (LEVELS[levelName] < threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level: levelName,
      logger: name,
      msg: redactText(String(message)),
    };
    if (context !== undefined) {
      const safe = redact(context);
      if (safe && typeof safe === 'object' && !Array.isArray(safe)) Object.assign(line, safe);
      else line.context = safe;
    }
    stream.write(`${JSON.stringify(line)}\n`);
  };

  const logger = {
    level,
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
    /** A logger that stamps every line with extra fields (component, syncId, …). */
    child: (fields) => {
      const base = createLogger({ level, name, stream });
      const wrap = (fn) => (msg, ctx) => fn(msg, { ...fields, ...(ctx || {}) });
      return {
        level,
        debug: wrap(base.debug),
        info: wrap(base.info),
        warn: wrap(base.warn),
        error: wrap(base.error),
        child: (more) => logger.child({ ...fields, ...more }),
      };
    },
  };

  return logger;
}

/** A logger that discards everything — the default in tests. */
export const nullLogger = createLogger({ level: 'silent', stream: { write() {} } });
