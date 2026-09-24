import { lazy } from 'react'
import { adminRoutes } from '#features/admin'
import { authRoutes } from '#features/auth'
import { offlineRoutes } from '#features/offline'
import { reportRoutes } from '#features/report'

const Home = lazy(() => import('./pages/Home.jsx'))

/**
 * The whole route table, assembled from the app's own pages plus each
 * feature's exported routes. This is the only file that knows the full URL
 * space, and features stay unaware of each other.
 *
 * @type {import('#shared/lib/routeSpec.js').RouteSpec[]}
 */
export const routes = [
  { path: '/', Component: Home, protected: true, title: '' },
  ...reportRoutes,
  ...offlineRoutes,
  ...adminRoutes,
  ...authRoutes,
]
