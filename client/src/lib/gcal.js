/** Client for the Google Calendar one-way sync endpoints. Reuses the shared LMS
 *  OAuth redirect handshake (beginConnect) with the pseudo-provider key
 *  'google_calendar', which the callback page routes back here. */
import { api } from '../api/client';

export const gcalApi = {
  status: () => api.get('/api/google-calendar/status').then((r) => r.data),
  authUrl: () => api.get('/api/google-calendar/auth-url').then((r) => r.data),
  connect: (body) => api.post('/api/google-calendar/connect', body).then((r) => r.data),
  disconnect: () => api.post('/api/google-calendar/disconnect').then((r) => r.data),
  setEnabled: (enabled) => api.post('/api/google-calendar/enabled', { enabled }).then((r) => r.data),
  sync: () => api.post('/api/google-calendar/sync').then((r) => r.data),
};

export function summarizeGcalSync(t) {
  const parts = [];
  if (t.created) parts.push(`${t.created} added`);
  if (t.updated) parts.push(`${t.updated} updated`);
  if (t.deleted) parts.push(`${t.deleted} removed`);
  return parts.length ? `Synced to Google Calendar (${parts.join(', ')})` : 'Google Calendar already up to date';
}
