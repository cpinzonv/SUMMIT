import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SettingsMenu } from './SettingsMenu';

// Settings now lives in the top-right gear menu (see SettingsMenu), not the nav.
const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/calendar', label: 'Calendar' },
  { to: '/planner', label: 'Planner' },
  { to: '/learn', label: 'Learn' },
];

export function Layout() {
  const { user } = useAuth();

  // Admins get an extra nav link; institution admins get their own (they aren't
  // students, so the student nav is replaced). The routes + backend are gated too.
  const items =
    user?.role === 'admin'
      ? [...navItems, { to: '/admin', label: 'Admin' }]
      : user?.role === 'institution_admin'
        ? [{ to: '/institution', label: 'Institution' }]
        : navItems;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/40 bg-white/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <NavLink
              to="/"
              className="font-display text-xl font-bold tracking-tight"
            >
              <span className="text-gradient">Summit</span>
            </NavLink>
            <nav className="flex gap-1">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                      isActive
                        ? 'bg-white/70 text-brand-700 shadow-sm'
                        : 'text-muted hover:bg-white/50 hover:text-ink'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden font-medium text-muted sm:inline">
              {user?.fullName}
            </span>
            <SettingsMenu />
          </div>
        </div>
      </header>

      {/* Graceful-downgrade notice: the student's institution had its access
          revoked — their data is intact, but premium features are disabled. */}
      {user?.institution?.revoked && (
        <div className="border-b border-amber-300/50 bg-amber-50/80">
          <div className="mx-auto max-w-5xl px-4 py-2.5 text-sm text-amber-800">
            <span className="font-semibold">
              {user.institution.name ? `${user.institution.name}’s` : 'Your institution’s'} Summit access has ended.
            </span>{' '}
            Your notes and classes are safe, but premium features are no longer available. Contact your school administrator to restore access.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
