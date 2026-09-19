import { lazy } from 'react'

/*
 * Route table for the auth feature.
 *
 * The lazy() calls live here rather than in the app router so that the code
 * boundary follows the feature boundary: the app composes route tables and
 * never reaches into a feature's pages folder.
 */
const Login = lazy(() => import('./pages/Login.jsx'))
const Register = lazy(() => import('./pages/Register.jsx'))
const VerifyOtp = lazy(() => import('./pages/VerifyOtp.jsx'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'))
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'))

/** @type {import('#shared/lib/routeSpec.js').RouteSpec[]} */
export const authRoutes = [
  { path: '/login', Component: Login, title: 'Sign in' },
  { path: '/register', Component: Register, title: 'Create an account' },
  { path: '/verify', Component: VerifyOtp, title: 'Verify your email' },
  { path: '/forgot-password', Component: ForgotPassword, title: 'Reset your password' },
  { path: '/reset-password', Component: ResetPassword, title: 'Choose a new password' },
]
