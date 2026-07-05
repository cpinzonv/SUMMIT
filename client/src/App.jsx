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
import LearnPage from './pages/LearnPage';
import ActivitiesPage from './pages/ActivitiesPage';
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
        {/* Schedule now lives inside the Planner as the "Schedule" sub-view. */}
        <Route path="/schedule" element={<Navigate to="/planner?view=schedule" replace />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/activities" element={<ActivitiesPage />} />
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
