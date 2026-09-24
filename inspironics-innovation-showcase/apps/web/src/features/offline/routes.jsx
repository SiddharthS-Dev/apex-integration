import { lazy } from 'react'

const OfflineLibrary = lazy(() => import('./pages/OfflineLibrary.jsx'))

/** @type {import('#shared/lib/routeSpec.js').RouteSpec[]} */
export const offlineRoutes = [{ path: '/offline', Component: OfflineLibrary, protected: true, title: 'Offline library' }]
