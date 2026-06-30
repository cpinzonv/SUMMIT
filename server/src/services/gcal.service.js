/**
 * Google Calendar one-way sync (Summit → Google).
 *
 * Summit is the source of truth: each sync creates/updates a Google Calendar
 * event per assignment date (a "due" event and, when set, a "planned" event) and
 * deletes events whose assignment was removed or completed. The mapping lives in
 * gcal_events so we update instead of duplicating, and can delete remotely.
 *
 * OAuth2 is Google's (same as Google Classroom) with the calendar.events scope.
 * Tokens are stored ENCRYPTED on the users row. When MOCK_GOOGLE_CALENDAR_MODE
 * (or LMS_MOCK) is set, the Google API calls are simulated so the whole flow runs
 * with no credentials and no network.
 *
 * Docs: https://developers.google.com/calendar/api/v3/reference/events
 */
import crypto from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { requestJson } from './lms/http.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'].join(' ');

function isMock() {
  return env.gcal.useMock;
}

export function isConfigured() {
  return isMock() || Boolean(env.gcal.clientId && env.gcal.clientSecret);
}

/* ---- Status ------------------------------------------------------------- */

export async function getStatus(userId) {
  const { rows } = await query(
    `SELECT gcal_connected, gcal_sync_enabled, gcal_synced_at FROM users WHERE id = $1`,
    [userId],
  );
  const r = rows[0] || {};
  return {
    connected: Boolean(r.gcal_connected),
    syncEnabled: r.gcal_sync_enabled !== false,
    syncedAt: r.gcal_synced_at ?? null,
    available: isConfigured(),
  };
}

/* ---- OAuth -------------------------------------------------------------- */

export function buildAuthUrl(userId, redirectUri) {
  if (!isConfigured()) throw new AppError(503, 'Google Calendar is not configured on the server.');
  const state = crypto.randomBytes(16).toString('hex');
  if (isMock()) {
    const sep = redirectUri.includes('?') ? '&' : '?';
    return { url: `${redirectUri}${sep}code=mock-gcal-code&state=${encodeURIComponent(state)}`, state };
  }
  const params = new URLSearchParams({
    client_id: env.gcal.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state };
}

async function exchange(form, redirectUri) {
  if (isMock()) {
    return { accessToken: 'mock-gcal-access-token', refreshToken: 'mock-gcal-refresh-token', expiresAt: new Date(Date.now() + 3600e3).toISOString() };
  }
  const data = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.gcal.clientId,
      client_secret: env.gcal.clientSecret,
      redirect_uri: redirectUri,
      ...form,
    }).toString(),
    label: 'Google Calendar',
  });
  if (!data?.access_token) throw AppError.badRequest('Google authorization failed: no access token.');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

export async function connect(userId, { code, redirectUri }) {
  const tokens = await exchange({ grant_type: 'authorization_code', code }, redirectUri);
  await query(
    `UPDATE users SET gcal_connected = true, gcal_access_token = $2, gcal_refresh_token = $3,
       gcal_token_expires_at = $4 WHERE id = $1`,
    [userId, encrypt(tokens.accessToken), tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokens.expiresAt ?? null],
  );
  return getStatus(userId);
}

export async function disconnect(userId) {
  await query(
    `UPDATE users SET gcal_connected = false, gcal_access_token = NULL, gcal_refresh_token = NULL,
       gcal_token_expires_at = NULL WHERE id = $1`,
    [userId],
  );
  return getStatus(userId);
}

export async function setEnabled(userId, enabled) {
  await query(`UPDATE users SET gcal_sync_enabled = $2 WHERE id = $1`, [userId, Boolean(enabled)]);
  return getStatus(userId);
}

async function getAccessToken(userId) {
  const { rows } = await query(`SELECT gcal_access_token, gcal_refresh_token FROM users WHERE id = $1`, [userId]);
  const r = rows[0];
  if (!r || !r.gcal_access_token) throw AppError.badRequest('Connect Google Calendar in Settings first.', { code: 'gcal_not_connected' });
  if (isMock()) return 'mock-gcal-access-token';
  return decrypt(r.gcal_access_token);
}

/* ---- Google Calendar event calls (simulated in mock mode) --------------- */

function eventBody(ev) {
  // All-day-ish: use a 1-hour block at the date's time.
  const start = new Date(ev.date);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    summary: `${ev.title} for ${ev.className}`,
    description: ev.kind === 'planned' ? 'Planned work (Summit)' : 'Due (Summit)',
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

async function gcalInsert(accessToken, ev) {
  if (isMock()) return `mock-evt-${ev.assignmentId}-${ev.kind}`;
  const data = await requestJson('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(eventBody(ev)),
    label: 'Google Calendar',
  });
  return data?.id;
}

async function gcalUpdate(accessToken, eventId, ev) {
  if (isMock()) return eventId;
  await requestJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(eventBody(ev)),
    label: 'Google Calendar',
  });
  return eventId;
}

async function gcalDelete(accessToken, eventId) {
  if (isMock()) return;
  await requestJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    label: 'Google Calendar',
  }).catch(() => {}); // already-gone is fine
}

/* ---- Sync --------------------------------------------------------------- */

/** Build the set of calendar events Summit wants to exist for this user. */
async function desiredEvents(userId) {
  const { rows } = await query(
    `SELECT a.id, a.title, a.due_date, a.planned_date, a.status,
            c.name AS class_name,
            (g.id IS NOT NULL) AS has_grade
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       LEFT JOIN grades g ON g.assignment_id = a.id
      WHERE c.user_id = $1 AND c.archived_at IS NULL`,
    [userId],
  );
  const out = [];
  for (const a of rows) {
    const done = a.status === 'submitted' || a.status === 'graded' || a.has_grade;
    if (a.due_date) out.push({ assignmentId: a.id, kind: 'due', date: a.due_date, title: a.title, className: a.class_name });
    if (a.planned_date && !done) out.push({ assignmentId: a.id, kind: 'planned', date: a.planned_date, title: a.title, className: a.class_name });
  }
  return out;
}

export async function sync(userId) {
  const status = await getStatus(userId);
  if (!status.connected) throw AppError.badRequest('Connect Google Calendar in Settings first.', { code: 'gcal_not_connected' });
  if (!status.syncEnabled) throw AppError.badRequest('Google Calendar sync is turned off.', { code: 'gcal_disabled' });

  const accessToken = await getAccessToken(userId);
  const desired = await desiredEvents(userId);
  const desiredKey = (e) => `${e.assignmentId}:${e.kind}`;
  const desiredMap = new Map(desired.map((e) => [desiredKey(e), e]));

  const { rows: existing } = await query(
    `SELECT assignment_id, kind, event_id FROM gcal_events WHERE user_id = $1`,
    [userId],
  );
  const existingMap = new Map(existing.map((r) => [`${r.assignment_id}:${r.kind}`, r.event_id]));

  const tally = { created: 0, updated: 0, deleted: 0 };

  // Create/update desired events.
  for (const [key, ev] of desiredMap) {
    const eventId = existingMap.get(key);
    if (eventId) {
      await gcalUpdate(accessToken, eventId, ev);
      tally.updated++;
    } else {
      const newId = await gcalInsert(accessToken, ev);
      await query(
        `INSERT INTO gcal_events (user_id, assignment_id, kind, event_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, assignment_id, kind) DO UPDATE SET event_id = EXCLUDED.event_id`,
        [userId, ev.assignmentId, ev.kind, newId],
      );
      tally.created++;
    }
  }

  // Delete events Summit no longer wants (assignment removed/completed/date cleared).
  for (const [key, eventId] of existingMap) {
    if (!desiredMap.has(key)) {
      await gcalDelete(accessToken, eventId);
      const [assignmentId, kind] = key.split(':');
      await query(`DELETE FROM gcal_events WHERE user_id = $1 AND assignment_id = $2 AND kind = $3`, [userId, assignmentId, kind]);
      tally.deleted++;
    }
  }

  await query(`UPDATE users SET gcal_synced_at = now() WHERE id = $1`, [userId]);
  return { ...tally, total: desiredMap.size };
}
