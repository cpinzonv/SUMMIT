/** Thin client for the Canvas/LMS endpoints + the OAuth redirect handshake. */
import { api } from '../api/client';

export const canvasApi = {
  status: () => api.get('/api/canvas/status').then((r) => r.data),
  authUrl: (domain) => api.get('/api/canvas/auth-url', { params: { domain } }).then((r) => r.data),
  connect: (body) => api.post('/api/auth/canvas/callback', body).then((r) => r.data),
  disconnect: () => api.post('/api/canvas/disconnect').then((r) => r.data),
  sync: () => api.post('/api/canvas/sync').then((r) => r.data),
  listCourseAssignments: (classId) =>
    api.get(`/api/canvas/courses/${classId}/assignments`).then((r) => r.data),
  import: (classId, externalIds) =>
    api.post(`/api/canvas/courses/${classId}/import`, { externalIds }).then((r) => r.data),
};

// We stash the OAuth state + domain across the redirect to Canvas and back so
// the callback page can validate state and complete the exchange.
const PENDING_KEY = 'sw_canvas_oauth';

export function beginConnect({ url, state, domain }) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state, domain }));
  window.location.assign(url);
}

export function readPendingConnect() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearPendingConnect() {
  sessionStorage.removeItem(PENDING_KEY);
}

/** Summarize a sync/import tally into a human sentence for a toast. */
export function summarizeSync(t) {
  const n = (t.imported || 0) + (t.updated || 0);
  if (!n && !t.imported) return 'Already up to date with Canvas';
  const parts = [];
  if (t.imported) parts.push(`${t.imported} new`);
  if (t.updated) parts.push(`${t.updated} updated`);
  const detail = parts.length ? ` (${parts.join(', ')})` : '';
  return `Synced ${t.imported || 0} assignment${(t.imported || 0) === 1 ? '' : 's'} from Canvas${detail}`;
}
