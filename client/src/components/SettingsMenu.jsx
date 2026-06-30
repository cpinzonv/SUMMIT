import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icon } from './learn/icons/Icon';

/**
 * Top-right header menu: a gear icon that opens a dropdown with "Account
 * Settings" and "Log out". Closes on outside-click, Escape, or item select.
 * Logout goes through AuthContext (revokes the refresh token + clears storage).
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { logout } = useAuth();

  // Close on outside click + Escape (only while open).
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const goSettings = () => {
    setOpen(false);
    navigate('/settings');
  };

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Settings"
        className="flex h-9 w-9 items-center justify-center rounded-full text-[#1B4C5C] transition hover:bg-brand-500/10 hover:text-brand-600 active:scale-95"
      >
        <Icon name="settings" size={22} />
      </button>

      {open && (
        <div
          role="menu"
          className="animate-menu-pop glass-panel absolute right-0 top-[calc(100%+0.5rem)] z-50 w-48 p-1.5 shadow-lg"
        >
          <button role="menuitem" className="menu-item text-[#1B4C5C]" onClick={goSettings}>
            Account Settings
          </button>
          <hr className="my-1 border-t border-white/50" />
          <button role="menuitem" className="menu-item font-semibold text-brand-600" onClick={handleLogout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
