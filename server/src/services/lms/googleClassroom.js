/**
 * Google Classroom provider.
 *
 * Implements the shared LMS provider interface (see ./index.js) against the
 * Google Classroom REST API. Unlike the other LMSs, Google is single-tenant
 * (everyone authenticates at accounts.google.com), so there is no per-institution
 * `domain` — the provider ignores it.
 *
 * OAuth2 (Google three-legged):
 *   authorize: https://accounts.google.com/o/oauth2/v2/auth   (offline + consent)
 *   token:     https://oauth2.googleapis.com/token
 *
 * Data:
 *   courses:     GET https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE
 *   coursework:  GET https://classroom.googleapis.com/v1/courses/{id}/courseWork
 *   grade:       GET .../courseWork/{id}/studentSubmissions?userId=me  (assignedGrade)
 *
 * MOCK_GOOGLE_CLASSROOM_MODE=true (or LMS_MOCK) swaps in the in-memory fixture.
 *
 * Docs: https://developers.google.com/classroom/reference/rest
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { requestJson, getJson, stripHtml } from './http.js';

export const name = 'google_classroom';
const LABEL = 'Google Classroom';
const cfg = () => env.lms.providers.google_classroom;

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
].join(' ');

export function isConfigured() {
  return Boolean(cfg().clientId && cfg().clientSecret);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'Google Classroom is not configured. Set GOOGLE_CLASSROOM_CLIENT_ID and GOOGLE_CLASSROOM_CLIENT_SECRET in the server environment.',
    );
  }
}

/** Step 1: Google consent URL. access_type=offline + prompt=consent → refresh token. */
export function buildAuthUrl({ redirectUri, state }) {
  assertConfigured();
  const params = new URLSearchParams({
    client_id: cfg().clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(form) {
  assertConfigured();
  const data = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: cfg().clientId, client_secret: cfg().clientSecret, ...form }).toString(),
    label: LABEL,
  });
  if (!data || !data.access_token) {
    throw AppError.badRequest('Google authorization failed: no access token returned.');
  }
  return {
    accessToken: data.access_token,
    // Google returns refresh_token only on the first consent (with prompt=consent).
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

export function exchangeCode({ redirectUri, code }) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refresh({ refreshToken }) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Google APIs paginate with { <field>: [...], nextPageToken }. */
async function googleGetAll(url, accessToken, field) {
  const out = [];
  let pageToken = null;
  for (let page = 0; page < 20; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const pageUrl = pageToken ? `${url}${sep}pageToken=${encodeURIComponent(pageToken)}` : url;
    const data = await getJson(pageUrl, accessToken, LABEL);
    if (!data) break;
    if (Array.isArray(data[field])) out.push(...data[field]);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export async function listCourses({ accessToken }) {
  const courses = await googleGetAll(
    'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=100',
    accessToken,
    'courses',
  );
  return courses.filter((c) => c && c.id && c.name).map(normalizeCourse);
}

export async function listAssignments({ accessToken, externalCourseId }) {
  const work = await googleGetAll(
    `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(externalCourseId)}/courseWork?pageSize=100`,
    accessToken,
    'courseWork',
  );
  const out = [];
  for (const w of work) {
    if (!w || !w.id) continue;
    const a = normalizeAssignment(w);
    // Best-effort grade fetch from the student's own submission.
    try {
      const subs = await googleGetAll(
        `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(externalCourseId)}/courseWork/${encodeURIComponent(w.id)}/studentSubmissions?userId=me`,
        accessToken,
        'studentSubmissions',
      );
      const graded = subs.find((s) => s.assignedGrade != null);
      if (graded && w.maxPoints) {
        a.grade = { pointsEarned: Number(graded.assignedGrade), pointsPossible: Number(w.maxPoints) };
      }
    } catch {
      // no submission/grade — leave null
    }
    out.push(a);
  }
  return out;
}

/* ---- Normalizers: Google Classroom shape → Summit shared LMS shape ------ */

function normalizeCourse(c) {
  return {
    externalId: String(c.id),
    name: c.name,
    code: c.section ?? c.descriptionHeading ?? null,
    term: null, // Google Classroom has no term concept
  };
}

/** Google splits due date into dueDate {year,month,day} + dueTime {hours,minutes} (UTC). */
function joinDueDate(w) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  const t = w.dueTime || {};
  const d = new Date(Date.UTC(year, (month || 1) - 1, day || 1, t.hours || 23, t.minutes || 59, 0));
  return d.toISOString();
}

function normalizeAssignment(w) {
  return {
    externalId: String(w.id),
    title: w.title,
    dueDate: joinDueDate(w),
    pointValue: w.maxPoints == null ? null : Number(w.maxPoints),
    description: stripHtml(w.description),
    url: w.alternateLink ?? null,
    grade: null,
  };
}
