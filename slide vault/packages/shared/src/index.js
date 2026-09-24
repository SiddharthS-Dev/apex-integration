/**
 * @slidesvault/shared — contracts both apps depend on.
 *
 * Rule for this package: it imports nothing. The API runs on bare Node and the
 * web app bundles through Vite, so anything with a runtime dependency (React,
 * lucide icons, Tailwind class names) belongs in the app that renders it, not
 * here.
 */

export * from './domains.js';
export * from './roles.js';
export * from './files.js';
