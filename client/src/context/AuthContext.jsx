import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import {
  api,
  setTokens,
  clearTokens,
  getAccessToken,
  getRefreshToken,
} from '../api/client';

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

const DEFAULT_PREFS = {
  theme: 'light',
  colorScheme: 'default',
  fontSize: 'normal',
  compactMode: false,
  defaultDashboardView: 'cards',
  defaultCalendarView: 'month',
  notificationsEnabled: false,
  showArchived: false,
};

/** Apply visual preferences (theme/font/compact) to the document root. */
function applyPreferences(prefs) {
  const root = document.documentElement;
  const theme = prefs.theme || 'light';
  const resolved =
    theme === 'auto'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  root.dataset.theme = resolved;
  root.dataset.font = prefs.fontSize || 'normal';
  root.dataset.compact = prefs.compactMode ? 'true' : 'false';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const preferences = { ...DEFAULT_PREFS, ...(user?.preferences || {}) };

  // On first load, if we have a token, validate it by fetching the profile.
  useEffect(() => {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    api
      .get('/api/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  // Apply visual preferences whenever they change. Reset to defaults on logout.
  useEffect(() => {
    applyPreferences({ ...DEFAULT_PREFS, ...(user?.preferences || {}) });
  }, [user]);

  // Re-resolve "auto" theme when the system scheme changes.
  useEffect(() => {
    if ((user?.preferences?.theme || 'light') !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPreferences({ ...DEFAULT_PREFS, ...user.preferences });
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [user]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/api/auth/login', { email, password });
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await api.post('/api/auth/register', payload);
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await api.post('/api/auth/logout', { refreshToken });
    } catch {
      // ignore — we clear local state regardless
    }
    clearTokens();
    setUser(null);
  }, []);

  /** Re-fetch the current user (e.g. after connecting/syncing Canvas). */
  const refreshUser = useCallback(async () => {
    const { data } = await api.get('/api/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  /** Optimistically update preferences locally, then persist. */
  const savePreferences = useCallback(async (partial) => {
    setUser((u) =>
      u ? { ...u, preferences: { ...u.preferences, ...partial } } : u,
    );
    try {
      const { data } = await api.patch('/api/user/preferences', partial);
      setUser((u) => (u ? { ...u, preferences: data.preferences } : u));
    } catch {
      // On failure, re-sync from the server.
      try {
        const { data } = await api.get('/api/auth/me');
        setUser(data.user);
      } catch {
        /* ignore */
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, preferences, login, register, logout, savePreferences, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
