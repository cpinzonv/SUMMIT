import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SettingsMenu } from './SettingsMenu';

// Small inline stroke icons for the mobile bottom tab bar (no icon dependency).
const I = {
  dashboard: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  calendar: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" />
    </svg>
  ),
  planner: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 6h11M4 12h11M4 18h7" /><path d="m17.5 15.5 2 2 3-3.5" />
    </svg>
  ),
  learn: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  ),
  admin: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    </svg>
  ),
  institution: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 21h18M5 21V8l7-4 7 4v13" /><path d="M9 21v-5h6v5" />
    </svg>
  ),
};

// Settings now lives in the top-right gear menu (see SettingsMenu), not the nav.
const navItems = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: I.dashboard, end: true },
  { to: '/calendar', label: 'Calendar', short: 'Calendar', icon: I.calendar },
  { to: '/planner', label: 'Planner', short: 'Planner', icon: I.planner },
  { to: '/learn', label: 'Learn', short: 'Learn', icon: I.learn },
];

export function Layout() {
  const { user } = useAuth();

  // Admins get an extra nav link; institution admins get their own (they aren't
  // students, so the student nav is replaced). The routes + backend are gated too.
  const items =
    user?.role === 'admin'
      ? [...navItems, { to: '/admin', label: 'Admin', short: 'Admin', icon: I.admin }]
      : user?.role === 'institution_admin'
        ? [{ to: '/institution', label: 'Institution', short: 'Institution', icon: I.institution }]
        : navItems;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/40 bg-white/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="font-display text-xl font-bold tracking-tight">
              <span className="text-gradient">Summit</span>
            </NavLink>
            {/* Desktop pill nav — hidden on mobile, where the bottom tab bar takes over. */}
            <nav className="hidden gap-1 md:flex">
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
            <span className="hidden font-medium text-muted sm:inline">{user?.fullName}</span>
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

      {/* Extra bottom padding on mobile so content clears the fixed tab bar. */}
      <main className="mx-auto max-w-5xl px-4 py-6 pb-24 md:py-10 md:pb-10">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar — thumb-reachable primary nav. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/40 bg-white/80 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition ${
                    isActive ? 'text-brand-600' : 'text-muted'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-6 w-6 ${isActive ? 'opacity-100' : 'opacity-80'}`} />
                    <span>{item.short}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
