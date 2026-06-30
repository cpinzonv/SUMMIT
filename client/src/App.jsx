import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ClassDetailPage from './pages/ClassDetailPage';
import CalendarPage from './pages/CalendarPage';
import CreateClassPage from './pages/CreateClassPage';
import ArchivePage from './pages/ArchivePage';
import PlannerPage from './pages/PlannerPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

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
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/archives" element={<ArchivePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
