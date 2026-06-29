import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const ACCESS_KEY = 'sw_access_token';
export const REFRESH_KEY = 'sw_refresh_token';

export const getAccessToken = () => localStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

export function setTokens({ accessToken, refreshToken }) {
  if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export const api = axios.create({ baseURL: API_URL });

// Attach the access token to every request.
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On a 401, try a single refresh-token rotation, then replay the request.
// If refresh fails (or there's no refresh token), clear auth and bounce to login.
let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Don't try to refresh for the auth endpoints themselves.
    const isAuthCall = original?.url?.includes('/api/auth/');

    if (status === 401 && !original?._retry && !isAuthCall) {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        forceLogout();
        return Promise.reject(error);
      }
      original._retry = true;
      try {
        refreshPromise =
          refreshPromise ||
          axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
        const { data } = await refreshPromise;
        refreshPromise = null;
        setTokens(data);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshError) {
        refreshPromise = null;
        forceLogout();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

function forceLogout() {
  clearTokens();
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

/** Pull a human-readable message out of an axios error. */
export function errorMessage(error, fallback = 'Something went wrong') {
  return (
    error?.response?.data?.error?.message ||
    error?.message ||
    fallback
  );
}
