import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/AuthContext';
import ProtectedRoute, { AuthLoading, PublicOnlyRoute } from '@/components/ProtectedRoute';
import ScrollToTop from '@/components/ScrollToTop';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';

const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const Home = lazy(() => import('@/pages/Home'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Library = lazy(() => import('@/pages/Library'));
const PresentationViewer = lazy(() => import('@/pages/PresentationViewer'));
const OfflineLibrary = lazy(() => import('@/pages/OfflineLibrary'));
const Admin = lazy(() => import('@/pages/Admin'));
const DropboxSettings = lazy(() => import('@/pages/DropboxSettings'));
const UserManual = lazy(() => import('@/pages/UserManual'));
const PageNotFound = lazy(() => import('@/pages/PageNotFound'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Mounted at '/vault/' by the Apex gateway, or '/' standalone. The router
        takes its basename from the same `base` that rewrites the asset URLs, so
        neither has to hard-code the mount point.
      */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <ScrollToTop />
          <Suspense fallback={<AuthLoading />}>
            <Routes>
              {/* Public */}
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <Login />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicOnlyRoute>
                    <Register />
                  </PublicOnlyRoute>
                }
              />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Authenticated */}
              <Route element={<ProtectedRoute />}>
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="/presentation/:id" element={<PresentationViewer />} />
                  <Route path="/offline" element={<OfflineLibrary />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/dropbox-settings" element={<DropboxSettings />} />
                  <Route path="/user-manual" element={<UserManual />} />
                </Route>
              </Route>

              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
