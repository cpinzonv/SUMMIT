/**
 * Moodle provider.
 *
 * Implements the shared LMS provider interface (see ./index.js) against the
 * Moodle Web Services REST API. Moodle is multi-tenant (each school runs its own
 * site), so every call takes a `domain` (the site URL).
 *
 * Auth note: Moodle's native programmatic auth is a *web service token* used as
 * the `wstoken` query parameter — not an OAuth2 bearer token. Newer Moodle sites
 * can additionally run as an OAuth2 server. This module:
 *   - exchanges the OAuth2 code at {site}/login/oauth2/token when the site is an
 *     OAuth2 server, and
 *   - uses the resulting access token as the Moodle `wstoken` for REST calls.
 * For a site WITHOUT OAuth2, an admin can instead provision a web service token
 * and store it directly as the access token — the data calls below are identical.
 *
 * Data (REST: {site}/webservice/rest/server.php?wstoken=..&wsfunction=..&moodlewsrestformat=json):
 *   user id:     core_webservice_get_site_info
 *   courses:     core_enrol_get_users_courses
 *   assignments: mod_assign_get_assignments
 *   grades:      mod_assign_get_grades
 *
 * MOCK_MOODLE_MODE=true (or LMS_MOCK) swaps in the in-memory fixture.
 *
 * Docs: https://docs.moodle.org/dev/Web_service_API_functions
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { normalizeHost, requestJson, stripHtml } from './http.js';

export const name = 'moodle';
const LABEL = 'Moodle';
const cfg = () => env.lms.providers.moodle;

export function isConfigured() {
  return Boolean(cfg().clientId && cfg().clientSecret);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'Moodle is not configured. Set MOODLE_CLIENT_ID and MOODLE_CLIENT_SECRET in the server environment.',
    );
  }
}

function baseUrl(domain) {
  return normalizeHost(domain, LABEL);
}

export function buildAuthUrl({ domain, redirectUri, state }) {
  assertConfigured();
  const params = new URLSearchParams({
    client_id: cfg().clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'webservice',
    state,
  });
  return `${baseUrl(domain)}/login/oauth2/auth?${params.toString()}`;
}

async function tokenRequest(domain, form) {
  assertConfigured();
  const data = await requestJson(`${baseUrl(domain)}/login/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: cfg().clientId, client_secret: cfg().clientSecret, ...form }).toString(),
    label: LABEL,
  });
  if (!data || !data.access_token) {
    throw AppError.badRequest('Moodle authorization failed: no access token returned.');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

export function exchangeCode({ domain, redirectUri, code }) {
  return tokenRequest(domain, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refresh({ domain, refreshToken }) {
  return tokenRequest(domain, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Call a Moodle web service function. The access token is used as wstoken. */
async function ws(domain, accessToken, wsfunction, params = {}) {
  const qs = new URLSearchParams({
    wstoken: accessToken,
    wsfunction,
    moodlewsrestformat: 'json',
    ...params,
  });
  const url = `${baseUrl(domain)}/webservice/rest/server.php?${qs.toString()}`;
  const data = await requestJson(url, { headers: { accept: 'application/json' }, label: LABEL });
  // Moodle returns HTTP 200 with an { exception, errorcode, message } body on error.
  if (data && data.exception) {
    if (data.errorcode === 'invalidtoken' || data.errorcode === 'accessexception') {
      throw new AppError(401, 'Moodle access token expired', { code: 'lms_token_expired' });
    }
    throw new AppError(502, `Moodle API error: ${data.message || data.errorcode}`);
  }
  return data;
}

export async function listCourses({ domain, accessToken }) {
  const info = await ws(domain, accessToken, 'core_webservice_get_site_info');
  const userid = info?.userid;
  if (!userid) throw new AppError(502, 'Moodle did not return the current user.');
  const courses = await ws(domain, accessToken, 'core_enrol_get_users_courses', { userid: String(userid) });
  return (Array.isArray(courses) ? courses : []).filter((c) => c && c.id).map(normalizeCourse);
}

export async function listAssignments({ domain, accessToken, externalCourseId }) {
  const res = await ws(domain, accessToken, 'mod_assign_get_assignments', {
    'courseids[0]': String(externalCourseId),
  });
  const course = res?.courses?.[0];
  const assignments = course?.assignments || [];

  // Best-effort grades for the assignments in this course.
  let gradeByAssign = {};
  try {
    const ids = {};
    assignments.forEach((a, i) => { ids[`assignmentids[${i}]`] = String(a.id); });
    const gradesRes = await ws(domain, accessToken, 'mod_assign_get_grades', ids);
    for (const g of gradesRes?.assignments || []) {
      const latest = (g.grades || []).filter((x) => Number(x.grade) >= 0).slice(-1)[0];
      if (latest) gradeByAssign[String(g.assignmentid)] = Number(latest.grade);
    }
  } catch {
    gradeByAssign = {};
  }

  return assignments.map((a) => normalizeAssignment(a, gradeByAssign[String(a.id)]));
}

/* ---- Normalizers: Moodle shape → Summit shared LMS shape ---------------- */

function normalizeCourse(c) {
  return {
    externalId: String(c.id),
    name: c.fullname || c.shortname,
    code: c.shortname ?? null,
    term: null,
  };
}

/** Moodle dates are Unix epoch SECONDS; 0 means "no date". Grade max is `grade` (>0). */
function epochToISO(sec) {
  return sec && Number(sec) > 0 ? new Date(Number(sec) * 1000).toISOString() : null;
}

function normalizeAssignment(a, earned) {
  const maxPoints = Number(a.grade) > 0 ? Number(a.grade) : null;
  const intro = (a.intro || '').toString();
  return {
    externalId: String(a.id),
    title: a.name,
    dueDate: epochToISO(a.duedate),
    pointValue: maxPoints,
    description: stripHtml(intro),
    url: null,
    grade: earned != null && maxPoints ? { pointsEarned: Number(earned), pointsPossible: maxPoints } : null,
  };
}
