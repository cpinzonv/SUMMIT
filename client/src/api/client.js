import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const ACCESS_KEY = 'sw_access_token';
export const REFRESH_KEY = 'sw_refresh_token';
export const DEVICE_KEY = 'sw_device_trust';

export const getAccessToken = () => localStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

// A "remember this device" trust token — lets a 2FA account skip the second step
// from this browser. Persists across logouts (it's device-bound, not session-bound).
export const getDeviceToken = () => localStorage.getItem(DEVICE_KEY);
export const setDeviceToken = (t) => t && localStorage.setItem(DEVICE_KEY, t);
export const clearDeviceToken = () => localStorage.removeItem(DEVICE_KEY);

export function setTokens({ accessToken, refreshToken }) {
  if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/** Decode a JWT's `exp` (seconds) without verifying the signature; null if unparseable. */
function jwtExp(token) {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/** True when there's no access token, or it's within `skewSec` of expiring. */
export function accessTokenExpiring(skewSec = 60) {
  const token = getAccessToken();
  if (!token) return true;
  const exp = jwtExp(token);
  if (exp == null) return false; // can't tell — let a real 401 drive the refresh
  return exp * 1000 - Date.now() < skewSec * 1000;
}

/** A genuine auth failure (bad/expired credentials) vs. a transient outage. */
export function isAuthError(err) {
  return err?.authFailure === true || (err?.response && [401, 403].includes(err.response.status));
}

export const api = axios.create({ baseURL: API_URL });

// Attach the access token to every request.
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Requests that must NOT trigger a refresh on 401: the refresh endpoint itself
// (avoids a loop) and the pre-authentication endpoints (a 401 there is a real
// credential error, not an expired session). Everything else — including
// /api/auth/me — is refreshable, so an expired access token is renewed silently
// instead of logging the user out.
const NO_REFRESH = [
  '/api/auth/refresh',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];
const shouldTryRefresh = (url = '') => !NO_REFRESH.some((p) => url.includes(p));

// Rotate the refresh token → a new access + refresh pair, deduping concurrent
// callers. Rejects with { authFailure } when there's no refresh token, else with
// the underlying error (inspect via isAuthError to decide whether to log out).
let refreshPromise = null;
export async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw { authFailure: true };
  try {
    refreshPromise = refreshPromise || axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    const { data } = await refreshPromise;
    setTokens(data);
    return data;
  } finally {
    refreshPromise = null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    if (status === 401 && !original?._retry && shouldTryRefresh(original?.url)) {
      original._retry = true;
      try {
        const { accessToken } = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (refreshError) {
        // Only end the session on a GENUINE auth failure (bad/expired refresh
        // token). A transient outage — a network error or 5xx while the backend
        // is restarting during a deploy — must NOT wipe still-valid tokens.
        if (isAuthError(refreshError)) forceLogout();
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
