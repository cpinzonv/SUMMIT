/**
 * Blackboard Learn provider.
 *
 * Implements the shared LMS provider interface (see ./index.js) against the
 * Blackboard Learn REST API. Blackboard is multi-tenant: each institution runs
 * its own host (e.g. "blackboard.school.edu"), so every call takes a `domain`.
 *
 * OAuth2 (3-legged Authorization Code):
 *   authorize: GET  https://{host}/learn/api/public/v1/oauth2/authorizationcode
 *   token:     POST https://{host}/learn/api/public/v1/oauth2/token   (HTTP Basic)
 *
 * Data:
 *   courses:     GET /learn/api/public/v1/users/{userId}/courses  → courseMemberships
 *                GET /learn/api/public/v1/courses/{courseId}       → course details
 *   assignments: GET /learn/api/public/v2/courses/{courseId}/gradebook/columns
 *   grade:       GET /learn/api/public/v2/courses/{courseId}/gradebook/columns/{id}/users/{userId}
 *
 * Real calls only run with credentials; MOCK_BLACKBOARD_MODE=true (or LMS_MOCK)
 * swaps in the in-memory fixture so the whole pipeline runs without them.
 *
 * Docs: https://developer.blackboard.com/portal/displayApi
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { normalizeHost, requestJson, getJson, stripHtml } from './http.js';

export const name = 'blackboard';
const LABEL = 'Blackboard';
const cfg = () => env.lms.providers.blackboard;

export function isConfigured() {
  return Boolean(cfg().clientId && cfg().clientSecret);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'Blackboard is not configured. Set BLACKBOARD_CLIENT_ID and BLACKBOARD_CLIENT_SECRET in the server environment.',
    );
  }
}

function baseUrl(domain) {
  return normalizeHost(domain, LABEL);
}

/** Step 1: the URL we send the user to in order to grant access. */
export function buildAuthUrl({ domain, redirectUri, state }) {
  assertConfigured();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg().clientId,
    redirect_uri: redirectUri,
    scope: 'read',
    state,
  });
  return `${baseUrl(domain)}/learn/api/public/v1/oauth2/authorizationcode?${params.toString()}`;
}

/** Blackboard authenticates the token endpoint with HTTP Basic (client:secret). */
function basicAuthHeader() {
  const creds = Buffer.from(`${cfg().clientId}:${cfg().clientSecret}`).toString('base64');
  return `Basic ${creds}`;
}

async function tokenRequest(domain, form) {
  assertConfigured();
  const data = await requestJson(`${baseUrl(domain)}/learn/api/public/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: basicAuthHeader(),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
    label: LABEL,
  });
  if (!data || !data.access_token) {
    throw AppError.badRequest('Blackboard authorization failed: no access token returned.');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

/** Step 2: exchange the authorization code for tokens. */
export function exchangeCode({ domain, redirectUri, code }) {
  return tokenRequest(domain, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

/** Refresh an expired access token. */
export function refresh({ domain, refreshToken }) {
  return tokenRequest(domain, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Blackboard paginates with { results: [...], paging: { nextPage: "<relative url>" } }. */
async function bbGetAll(domain, accessToken, path) {
  const out = [];
  let url = `${baseUrl(domain)}${path}`;
  for (let page = 0; page < 20 && url; page++) {
    const data = await getJson(url, accessToken, LABEL);
    if (!data) break;
    if (Array.isArray(data.results)) out.push(...data.results);
    else if (Array.isArray(data)) out.push(...data);
    const next = data.paging?.nextPage;
    url = next ? `${baseUrl(domain)}${next}` : null;
  }
  return out;
}

/** Resolve the authenticated user's Blackboard id (needed for memberships/grades). */
async function getUserId(domain, accessToken) {
  const me = await getJson(`${baseUrl(domain)}/learn/api/public/v1/users/me`, accessToken, LABEL);
  if (!me || !me.id) throw new AppError(502, 'Blackboard did not return the current user.');
  return me.id;
}

export async function listCourses({ domain, accessToken }) {
  const userId = await getUserId(domain, accessToken);
  const memberships = await bbGetAll(
    domain,
    accessToken,
    `/learn/api/public/v1/users/${encodeURIComponent(userId)}/courses?limit=100`,
  );
  const courses = [];
  for (const m of memberships) {
    const courseId = m.courseId || m.course?.id;
    if (!courseId) continue;
    const c = await getJson(
      `${baseUrl(domain)}/learn/api/public/v1/courses/${encodeURIComponent(courseId)}`,
      accessToken,
      LABEL,
    ).catch(() => null);
    if (c && (c.availability?.available !== 'No')) courses.push(normalizeCourse(c));
  }
  return courses;
}

export async function listAssignments({ domain, accessToken, externalCourseId }) {
  const columns = await bbGetAll(
    domain,
    accessToken,
    `/learn/api/public/v2/courses/${encodeURIComponent(externalCourseId)}/gradebook/columns?limit=100`,
  );
  const userId = await getUserId(domain, accessToken);

  const out = [];
  for (const col of columns) {
    if (!col || !col.id) continue;
    // Only columns that are gradable assignments (have a score / are graded).
    const normalized = normalizeAssignment(col);
    // Best-effort grade fetch (ignore failures — many columns have no user grade).
    try {
      const g = await getJson(
        `${baseUrl(domain)}/learn/api/public/v2/courses/${encodeURIComponent(
          externalCourseId,
        )}/gradebook/columns/${encodeURIComponent(col.id)}/users/${encodeURIComponent(userId)}`,
        accessToken,
        LABEL,
      );
      const possible = col.score?.possible;
      if (g && g.score != null && possible) {
        normalized.grade = { pointsEarned: Number(g.score), pointsPossible: Number(possible) };
      }
    } catch {
      // no grade for this column — leave grade null
    }
    out.push(normalized);
  }
  return out;
}

/* ---- Normalizers: Blackboard shape → Summit shared LMS shape ------------ */

function normalizeCourse(c) {
  return {
    externalId: String(c.id),
    name: c.name,
    code: c.courseId ?? null, // Blackboard's human course id, e.g. "BIO-150-01"
    term: c.termId ?? null,
  };
}

function normalizeAssignment(col) {
  const possible = col.score?.possible;
  return {
    externalId: String(col.id),
    title: col.name,
    dueDate: col.grading?.due ?? null, // ISO 8601
    pointValue: possible == null ? null : Number(possible),
    description: stripHtml(col.description),
    url: null,
    grade: null,
  };
}
