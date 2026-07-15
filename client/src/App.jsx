import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import LoginPage from './pages/LoginPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import ClassDetailPage from './pages/ClassDetailPage';
import CalendarPage from './pages/CalendarPage';
import CreateClassPage from './pages/CreateClassPage';
import PlannerPage from './pages/PlannerPage';
import WeeklySchedulePage from './pages/WeeklySchedulePage';
import LearnPage from './pages/LearnPage';
import ActivityDetailPage from './pages/ActivityDetailPage';
import SettingsPage from './pages/SettingsPage';
import LmsCallbackPage from './pages/LmsCallbackPage';
import AdminAnalytics from './pages/AdminAnalytics';
import SetPasswordPage from './pages/SetPasswordPage';
import InstitutionDashboardPage from './pages/InstitutionDashboardPage';
import { InstitutionAdminRoute } from './components/InstitutionAdminRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Same page as /login; opens in register mode. Used by invite links
          (/register?invite=CODE) and by anyone typing /register directly. */}
      <Route path="/register" element={<LoginPage />} />
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/classes/new" element={<CreateClassPage />} />
        <Route path="/classes/:id" element={<ClassDetailPage />} />
        {/* Top-level Schedule tab: the student's ACTUAL current weekly schedule,
            derived from active classes' meeting times. Distinct from the Planner's
            own (future/hypothetical) "Schedule" sub-view, which is untouched. */}
        <Route path="/schedule" element={<WeeklySchedulePage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/activities/:id" element={<ActivityDetailPage />} />
        {/* Archives now live inside the Planner as the "Archived" tab. */}
        <Route path="/archives" element={<Navigate to="/planner?tab=archived" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/lms/callback" element={<LmsCallbackPage />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminAnalytics />
            </AdminRoute>
          }
        />
        <Route
          path="/institution"
          element={
            <InstitutionAdminRoute>
              <InstitutionDashboardPage />
            </InstitutionAdminRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
