import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Build an in-app URL for a page name, used by nav helpers. */
export function createPageUrl(name, params) {
  const base = name.startsWith('/') ? name : `/${name.toLowerCase()}`;
  if (!params) return base;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function timeAgo(date) {
  if (!date) return 'never';
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return 'never';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function formatDate(date, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const wantsTime = Boolean(opts?.timeStyle || opts?.hour || opts?.minute);
  return wantsTime ? d.toLocaleString(undefined, opts) : d.toLocaleDateString(undefined, opts);
}

export function initials(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  );
}

/** Stable pseudo-random number from a string seed (keeps demo data deterministic). */
export function hashSeed(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function truncate(str = '', max = 120) {
  return str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str;
}
