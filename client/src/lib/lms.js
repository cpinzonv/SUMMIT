/**
 * Thin client for the multi-provider LMS endpoints + the OAuth redirect
 * handshake. Every provider (canvas, blackboard, google_classroom, brightspace,
 * moodle, sakai) shares the same REST shape under /api/<provider>/*, so this is
 * parameterized by provider key.
 */
import { api } from '../api/client';

/** Per-provider display metadata (server returns label + needsDomain; this adds
 *  the cosmetic/help bits the UI needs). Keyed by provider key. */
export const LMS_META = {
  canvas: {
    label: 'Canvas',
    accent: '#e2410b',
    domainLabel: 'Canvas web address',
    domainPlaceholder: 'school.instructure.com',
    domainHelp: 'The address you use to log into Canvas (e.g. asu.instructure.com).',
  },
  blackboard: {
    label: 'Blackboard',
    accent: '#262626',
    domainLabel: 'Blackboard web address',
    domainPlaceholder: 'blackboard.school.edu',
    domainHelp: 'The address you use to log into Blackboard Learn.',
  },
  google_classroom: {
    label: 'Google Classroom',
    accent: '#1a73e8',
    domainLabel: null,
    domainPlaceholder: null,
    domainHelp: 'Sign in with the Google account you use for Classroom.',
  },
  brightspace: {
    label: 'Brightspace',
    accent: '#ff6b00',
    domainLabel: 'Brightspace web address',
    domainPlaceholder: 'school.brightspace.com',
    domainHelp: 'The address you use to log into Brightspace (D2L).',
  },
  moodle: {
    label: 'Moodle',
    accent: '#f98012',
    domainLabel: 'Moodle site address',
    domainPlaceholder: 'moodle.school.edu',
    domainHelp: 'The address of your school’s Moodle site.',
  },
  sakai: {
    label: 'Sakai',
    accent: '#1d6fb8',
    domainLabel: 'Sakai site address',
    domainPlaceholder: 'sakai.school.edu',
    domainHelp: 'The address of your school’s Sakai site.',
  },
};

export function lmsLabel(provider) {
  return LMS_META[provider]?.label || provider;
}

export function lmsAccent(provider) {
  return LMS_META[provider]?.accent || '#6366f1';
}

/** Status for every registered provider (drives the Settings cards + menus). */
export const lmsStatusAll = () => api.get('/api/lms/status').then((r) => r.data.providers);

/** A REST client bound to one provider. */
export function lmsApi(provider) {
  const base = `/api/${provider}`;
  return {
    provider,
    status: () => api.get(`${base}/status`).then((r) => r.data),
    authUrl: (domain) => api.get(`${base}/auth-url`, { params: domain ? { domain } : {} }).then((r) => r.data),
    connect: (body) => api.post(`${base}/connect`, body).then((r) => r.data),
    disconnect: () => api.post(`${base}/disconnect`).then((r) => r.data),
    sync: () => api.post(`${base}/sync`).then((r) => r.data),
    listCourseAssignments: (classId) =>
      api.get(`${base}/courses/${classId}/assignments`).then((r) => r.data),
    import: (classId, externalIds) =>
      api.post(`${base}/courses/${classId}/import`, { externalIds }).then((r) => r.data),
  };
}

// We stash the OAuth provider + state + domain across the redirect to the LMS and
// back so the callback page can validate state and complete the exchange.
const PENDING_KEY = 'sw_lms_oauth';

export function beginConnect({ provider, url, state, domain }) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ provider, state, domain }));
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
export function summarizeSync(t, provider) {
  const label = lmsLabel(provider || t.provider);
  const n = (t.imported || 0) + (t.updated || 0);
  if (!n) return `Already up to date with ${label}`;
  const parts = [];
  if (t.imported) parts.push(`${t.imported} new`);
  if (t.updated) parts.push(`${t.updated} updated`);
  const detail = parts.length ? ` (${parts.join(', ')})` : '';
  return `Synced ${t.imported || 0} assignment${(t.imported || 0) === 1 ? '' : 's'} from ${label}${detail}`;
}
