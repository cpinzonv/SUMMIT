import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FullPageSpinner } from './ui';

/**
 * Gate routes behind the institution-admin role (school IT). Non-matching users
 * bounce to /. The backend independently enforces this (requireInstitutionAdmin
 * → 403); this is just UX.
 */
export function InstitutionAdminRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role !== 'institution_admin') return <Navigate to="/" replace />;
  return children;
}
