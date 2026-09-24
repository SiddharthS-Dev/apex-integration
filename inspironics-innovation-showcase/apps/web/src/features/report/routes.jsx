import { lazy } from 'react'

const MonthlyReport = lazy(() => import('./pages/MonthlyReport.jsx'))

/** @type {import('#shared/lib/routeSpec.js').RouteSpec[]} */
export const reportRoutes = [
  { path: '/report', Component: MonthlyReport, protected: true, title: 'Monthly report' },
]
