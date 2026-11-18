import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { getSetting, setSetting } from '../repo/settings.js';
import { dayStart, monthStart, recordGeneration, totalsSince } from './log.js';

// Usage limits. Defaults come from the environment (AI_DAILY_LIMIT, AI_MONTHLY_BUDGET,
// TTS_MONTHLY_CHARACTER_LIMIT, VIDEO_MONTHLY_RENDER_LIMIT); administrators can change them at runtime
// (stored in settings). null = no limit. When a limit is reached, new paid requests are refused with
// 429 and existing generated content is untouched.

const KEY = 'usage.limits';
const FIELDS = ['aiDailyRequests', 'aiMonthlyBudgetUsd', 'ttsMonthlyChars', 'videoMonthlyMinutes'];

export async function getLimits() {
  const saved = (await getSetting(KEY, {})) || {};
  return Object.fromEntries(FIELDS.map((f) => [f, Object.hasOwn(saved, f) ? saved[f] : config.limits[f]]));
}

export async function setLimits(patch = {}) {
  const current = await getLimits();
  const next = { ...current };
  for (const f of FIELDS) {
    if (!Object.hasOwn(patch, f)) continue;
    const v = patch[f];
    if (v === null || v === '') next[f] = null;
    else if (Number.isFinite(Number(v)) && Number(v) >= 0) next[f] = Number(v);
    else throw new HttpError(400, `${f} must be a non-negative number or empty`);
  }
  await setSetting(KEY, next);
  return next;
}

export class LimitError extends HttpError {
  constructor(message) {
    super(429, message);
    this.code = 'usage_limit';
  }
}

/** Throws a LimitError (and logs the blocked request) when `kind` is over a configured limit. */
export async function assertWithinLimits(kind, { provider, characters = 0 } = {}) {
  const limits = await getLimits();
  let reason = null;
  if (kind === 'ai') {
    if (limits.aiDailyRequests != null) {
      const today = await totalsSince(dayStart());
      if (today.ai.requests >= limits.aiDailyRequests) reason = `the daily AI request limit (${limits.aiDailyRequests}) is reached`;
    }
    if (!reason && limits.aiMonthlyBudgetUsd != null) {
      const month = await totalsSince(monthStart());
      const spent = month.ai.cost_usd + month.tts.cost_usd;
      if (spent >= limits.aiMonthlyBudgetUsd) reason = `the monthly AI budget ($${limits.aiMonthlyBudgetUsd}) is used up (estimated $${spent.toFixed(2)})`;
    }
  } else if (kind === 'tts') {
    if (limits.ttsMonthlyChars != null) {
      const month = await totalsSince(monthStart());
      if (month.tts.characters + characters > limits.ttsMonthlyChars) reason = `the monthly voice-over limit (${limits.ttsMonthlyChars.toLocaleString('en-US')} characters) would be exceeded`;
    }
    if (!reason && limits.aiMonthlyBudgetUsd != null) {
      const month = await totalsSince(monthStart());
      const spent = month.ai.cost_usd + month.tts.cost_usd;
      if (spent >= limits.aiMonthlyBudgetUsd) reason = `the monthly AI budget ($${limits.aiMonthlyBudgetUsd}) is used up (estimated $${spent.toFixed(2)})`;
    }
  } else if (kind === 'render') {
    if (limits.videoMonthlyMinutes != null) {
      const month = await totalsSince(monthStart());
      if (month.render.seconds / 60 >= limits.videoMonthlyMinutes) reason = `the monthly video rendering limit (${limits.videoMonthlyMinutes} minutes) is reached`;
    }
  }
  if (!reason) return;
  await recordGeneration({ kind, provider, status: 'blocked', error: reason });
  throw new LimitError(`Generation paused: ${reason}. An administrator can raise the limit in AI Studio → Usage & budget.`);
}
