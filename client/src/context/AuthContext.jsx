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
    // 2FA accounts get a challenge instead of tokens — caller shows the code step.
    if (data.twoFactorRequired) return { twoFactorRequired: true, challengeToken: data.challengeToken };
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  /** Complete the 2FA login step with a TOTP or backup code. */
  const completeTwoFactor = useCallback(async (challengeToken, code) => {
    const { data } = await api.post('/api/auth/login/2fa', { challengeToken, code });
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  /**
   * Finish an OAuth social login: the provider flow handed the SPA a fresh
   * access + refresh token pair (via the callback page), so store them and load
   * the profile. No password ever touches the client.
   */
  const loginWithTokens = useCallback(async ({ accessToken, refreshToken }) => {
    setTokens({ accessToken, refreshToken });
    const { data } = await api.get('/api/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await api.post('/api/auth/register', payload);
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  /**
   * Request a password-reset email. Resolves with the server's (generic)
   * message; never reveals whether the email is registered.
   */
  const forgotPassword = useCallback(async (email) => {
    const { data } = await api.post('/api/auth/forgot-password', { email });
    return data.message;
  }, []);

  /** Complete a password reset with the token from the emailed link. */
  const resetPassword = useCallback(async (token, newPassword) => {
    const { data } = await api.post('/api/auth/reset-password', { token, newPassword });
    return data.message;
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
      value={{ user, loading, preferences, login, completeTwoFactor, loginWithTokens, register, forgotPassword, resetPassword, logout, savePreferences, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
