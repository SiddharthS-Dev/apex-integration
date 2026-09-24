import { lazy } from 'react'

const AdminConsole = lazy(() => import('./pages/AdminConsole.jsx'))

/** @type {import('#shared/lib/routeSpec.js').RouteSpec[]} */
export const adminRoutes = [{ path: '/admin', Component: AdminConsole, admin: true, title: 'Admin console' }]
