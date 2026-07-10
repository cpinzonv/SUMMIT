import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SettingsMenu } from './SettingsMenu';

// Organic, rounded tab-bar icons — soft flowing shapes drawn with a coral→teal
// gradient stroke when active (falls back to the muted text color otherwise), to
// match Summit's glassmorphic, hand-drawn feel. Custom SVG, no icon dependency.
const ICON_PATHS = {
  home: (
    <>
      <path d="M4.4 11.3 12 4.9l7.6 6.4" />
      <path d="M6 10.2v7.1c0 .8.6 1.5 1.4 1.5h9.2c.8 0 1.4-.7 1.4-1.5v-7.1" />
      <path d="M9.8 18.8v-3.3c0-1.2 1-2.2 2.2-2.2s2.2 1 2.2 2.2v3.3" />
    </>
  ),
  todo: (
    <>
      <path d="M12 3.6c3.1 0 4.7.1 6.1 1.5S19.6 8.9 19.6 12s-.1 4.7-1.5 6.1-3 1.5-6.1 1.5-4.7-.1-6.1-1.5S4.4 15.1 4.4 12s.1-4.7 1.5-6.1S8.9 3.6 12 3.6Z" />
      <path d="m8.6 12.3 2.3 2.3 4.5-4.9" />
    </>
  ),
  planner: (
    <>
      <path d="M2.8 18.3 8.3 9.2c.5-.82 1.7-.8 2.17.05l4.03 7.35" />
      <path d="m11 14.6 3.1-5.1c.5-.83 1.72-.8 2.18.06l4 7.35" />
      <circle cx="17.6" cy="6.4" r="1.7" />
    </>
  ),
  learn: (
    <>
      <path d="M12 6.6C10.2 5.3 8 4.9 6 5.2c-.6.1-1 .6-1 1.2v8.9c0 .7.6 1.2 1.3 1.1 1.8-.3 3.8.1 5.7 1.2" />
      <path d="M12 6.6c1.8-1.3 4-1.7 6-1.4.6.1 1 .6 1 1.2v8.9c0 .7-.6 1.2-1.3 1.1-1.8-.3-3.8.1-5.7 1.2" />
      <path d="M12 6.6v11" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3.6 18 5.9c.5.2.9.7.9 1.3v4.2c0 3.9-2.5 7.2-6.6 8.6-.2.06-.4.06-.6 0-4.1-1.4-6.6-4.7-6.6-8.6V7.2c0-.6.4-1.1.9-1.3L12 3.6Z" />
      <path d="m9.2 12 2 2 3.6-3.9" />
    </>
  ),
  institution: (
    <>
      <path d="M3.8 20h16.4" />
      <path d="M6 20V8.6c0-.5.3-1 .8-1.2l4.4-2c.5-.24 1.1-.24 1.6 0l4.4 2c.5.23.8.7.8 1.2V20" />
      <path d="M10 20v-3.4c0-.6.4-1 1-1h2c.6 0 1 .4 1 1V20" />
    </>
  ),
};

function TabIcon({ name, active }) {
  const gid = `tab-grad-${name}`;
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden>
      {active && (
        <defs>
          <linearGradient id={gid} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: 'var(--tab-grad-1)' }} />
            <stop offset="0.5" style={{ stopColor: 'var(--tab-grad-2)' }} />
            <stop offset="1" style={{ stopColor: 'var(--tab-grad-3)' }} />
          </linearGradient>
        </defs>
      )}
      <g stroke={active ? `url(#${gid})` : 'currentColor'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {ICON_PATHS[name]}
      </g>
    </svg>
  );
}

// Settings now lives in the top-right gear menu (see SettingsMenu), not the nav.
const navItems = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: 'home', end: true },
  { to: '/calendar', label: 'To-Do', short: 'To-Do', icon: 'todo' },
  { to: '/planner', label: 'Planner', short: 'Planner', icon: 'planner' },
  { to: '/learn', label: 'Learn', short: 'Learn', icon: 'learn' },
];

export function Layout() {
  const { user, preferences } = useAuth();

  // Students can hide the Planner tab from the nav (Settings → Preferences).
  const studentNav = preferences?.hidePlanner ? navItems.filter((i) => i.to !== '/planner') : navItems;

  // Admins get an extra nav link; institution admins get their own (they aren't
  // students, so the student nav is replaced). The routes + backend are gated too.
  const items =
    user?.role === 'admin'
      ? [...studentNav, { to: '/admin', label: 'Admin', short: 'Admin', icon: 'admin' }]
      : user?.role === 'institution_admin'
        ? [{ to: '/institution', label: 'Institution', short: 'Institution', icon: 'institution' }]
        : studentNav;

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
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition ${
                  isActive ? 'text-brand-600' : 'text-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Soft gradient glow behind the active icon. */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1.5 h-9 w-12 rounded-[1.4rem] opacity-25 blur-md"
                      style={{ backgroundImage: 'var(--grad-teal-purple)' }}
                    />
                  )}
                  <TabIcon name={item.icon} active={isActive} />
                  <span>{item.short}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
