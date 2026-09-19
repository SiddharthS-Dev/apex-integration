/**
 * Public surface of the monthly report feature.
 *
 * Only the route table. `lib/reportPdf.js` is deliberately *not* re-exported:
 * it imports jsPDF, and because `app/routes.jsx` imports this barrel eagerly,
 * re-exporting it put 114 KB of gzipped PDF machinery into the entry graph —
 * downloaded on every visit, including the login page, for a page most people
 * never open. The lazy page imports it directly instead.
 */
export { reportRoutes } from './routes.jsx'
