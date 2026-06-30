import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FullPageSpinner } from './ui';

/**
 * Gate routes behind an admin role. Layers on top of ProtectedRoute:
 *   - no user            → /login
 *   - signed in, non-admin → /dashboard (silently — the nav link is hidden too)
 *   - admin              → render children
 * The backend independently enforces this (adminOnly → 403); this is just UX.
 */
export function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}
