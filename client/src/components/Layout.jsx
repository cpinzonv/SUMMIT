import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SettingsMenu } from './SettingsMenu';

// Settings now lives in the top-right gear menu (see SettingsMenu), not the nav.
const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/schedule', label: 'Schedule' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/planner', label: 'Planner' },
  { to: '/learn', label: 'Learn' },
];

export function Layout() {
  const { user } = useAuth();

  // Admins get an extra nav link. Never shown to regular users; the route and
  // the backend are independently gated too.
  const items =
    user?.role === 'admin'
      ? [...navItems, { to: '/admin', label: 'Admin' }]
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

      <main className="mx-auto max-w-5xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
