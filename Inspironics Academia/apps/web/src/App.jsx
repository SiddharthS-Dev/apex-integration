import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/AuthContext';
import { queryClientInstance } from '@/lib/query-client';
import PageNotFound from '@/lib/PageNotFound';
import ProtectedRoute from '@/components/ProtectedRoute';
import AdminGuard from '@/components/AdminGuard';
import ScrollToTop from '@/components/ScrollToTop';
import ApexHandoff from '@/components/auth/ApexHandoff';
import { APEX_MOUNT } from '@/lib/mount';

import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import LearnerDashboard from '@/pages/LearnerDashboard';
import CourseCatalog from '@/pages/CourseCatalog';
import CourseView from '@/pages/CourseView';
import LessonPlayer from '@/pages/LessonPlayer';
import ChapterTest from '@/pages/ChapterTest';
import FinalTest from '@/pages/FinalTest';
import MyLearning from '@/pages/MyLearning';
import Tests from '@/pages/Tests';
import Certificates from '@/pages/Certificates';
import CertificateView from '@/pages/CertificateView';
import CertificateVerify from '@/pages/CertificateVerify';
import Playbooks from '@/pages/Playbooks';
import BookmarkList from '@/pages/BookmarkList';
import Profile from '@/pages/Profile';

import AdminDashboard from '@/pages/admin/AdminDashboard';
import PlaybookImport from '@/pages/admin/PlaybookImport';
import ContentStudio from '@/pages/admin/ContentStudio';
import PlaybookVersionHistory from '@/pages/admin/PlaybookVersionHistory';
import AdminCourseList from '@/pages/admin/AdminCourseList';
import AdminCourseEditor from '@/pages/admin/AdminCourseEditor';
import AdminQuestions from '@/pages/admin/AdminQuestions';
import AdminLearners from '@/pages/admin/AdminLearners';
import Integrations from '@/pages/admin/Integrations';

// Under Apex the sign-in is Apex's (one account opens every platform), so this app's own login and
// register hand the browser over to it, and so does a protected page reached signed out.
const signIn = (page) => (APEX_MOUNT ? <ApexHandoff /> : page);

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        {/* Mounted at '/academia/' by the Apex gateway, or '/' standalone: BASE_URL tracks vite's `base`. */}
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <ScrollToTop />
          <Routes>
            {/* Public */}
            <Route path="/verify/:certificateId" element={<CertificateVerify />} />
            <Route path="/login" element={signIn(<Login />)} />
            <Route path="/register" element={signIn(<Register />)} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Authenticated */}
            <Route element={<ProtectedRoute unauthenticatedElement={signIn(<Navigate to="/login" replace />)} />}>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<LearnerDashboard />} />
              <Route path="/my-learning" element={<MyLearning />} />
              <Route path="/tests" element={<Tests />} />
              <Route path="/certificates" element={<Certificates />} />
              <Route path="/playbooks" element={<Playbooks />} />
              <Route path="/bookmarks" element={<BookmarkList />} />
              <Route path="/profile" element={<Profile />} />

              {/* Admin */}
              <Route path="/admin/playbooks" element={<AdminGuard><PlaybookImport /></AdminGuard>} />
              <Route path="/admin/studio/:playbookId" element={<AdminGuard><ContentStudio /></AdminGuard>} />
              <Route path="/admin/playbooks/:playbookId/versions" element={<AdminGuard><PlaybookVersionHistory /></AdminGuard>} />
              <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
              <Route path="/admin/courses" element={<AdminGuard><AdminCourseList /></AdminGuard>} />
              <Route path="/admin/courses/:courseId/edit" element={<AdminGuard><AdminCourseEditor /></AdminGuard>} />
              <Route path="/admin/questions" element={<AdminGuard><AdminQuestions /></AdminGuard>} />
              <Route path="/admin/learners" element={<AdminGuard><AdminLearners /></AdminGuard>} />
              <Route path="/admin/integrations" element={<AdminGuard><Integrations /></AdminGuard>} />

              {/* Learner */}
              <Route path="/courses" element={<CourseCatalog />} />
              <Route path="/courses/:courseId" element={<CourseView />} />
              <Route path="/learn/:courseId/:lessonId" element={<LessonPlayer />} />
              <Route path="/test/chapter/:moduleId" element={<ChapterTest />} />
              <Route path="/test/final/:courseId" element={<FinalTest />} />
              <Route path="/certificate/:courseId" element={<CertificateView />} />
            </Route>

            <Route path="*" element={<PageNotFound />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}
