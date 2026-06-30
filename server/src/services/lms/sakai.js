/**
 * Sakai provider.
 *
 * Implements the shared LMS provider interface (see ./index.js) against the
 * Sakai Entity Broker REST API ("/direct"). Sakai is multi-tenant (each school
 * runs its own site), so every call takes a `domain`.
 *
 * Auth note: Sakai exposes an OAuth provider tool on many deployments; this
 * module performs the standard OAuth2 Authorization Code flow against
 * {site}/oauth/... when available, and sends the resulting bearer token on the
 * REST calls. (Some Sakai installs instead authenticate /direct via a session
 * established with a username/password POST to {site}/direct/session — if your
 * deployment uses that, swap exchangeCode accordingly.)
 *
 * Data (Entity Broker; .json views):
 *   sites:        GET {site}/direct/site.json                  (the user's sites)
 *   assignments:  GET {site}/direct/assignment/site/{siteId}.json
 *
 * MOCK_SAKAI_MODE=true (or LMS_MOCK) swaps in the in-memory fixture.
 *
 * Docs: https://github.com/sakaiproject/sakai (Entity Broker / web services)
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { normalizeHost, requestJson, getJson, stripHtml } from './http.js';

export const name = 'sakai';
const LABEL = 'Sakai';
const cfg = () => env.lms.providers.sakai;

export function isConfigured() {
  return Boolean(cfg().clientId && cfg().clientSecret);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'Sakai is not configured. Set SAKAI_CLIENT_ID and SAKAI_CLIENT_SECRET in the server environment.',
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
    scope: 'read',
    state,
  });
  return `${baseUrl(domain)}/oauth/authorize?${params.toString()}`;
}

function basicAuthHeader() {
  const creds = Buffer.from(`${cfg().clientId}:${cfg().clientSecret}`).toString('base64');
  return `Basic ${creds}`;
}

async function tokenRequest(domain, form) {
  assertConfigured();
  const data = await requestJson(`${baseUrl(domain)}/oauth/token`, {
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
    throw AppError.badRequest('Sakai authorization failed: no access token returned.');
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

export async function listCourses({ domain, accessToken }) {
  const data = await getJson(`${baseUrl(domain)}/direct/site.json`, accessToken, LABEL);
  const sites = data?.site_collection || [];
  // Only course sites (type 'course'); drop "My Workspace" / project sites.
  return sites
    .filter((s) => s && s.id && (s.type === 'course' || !s.type))
    .map(normalizeCourse);
}

export async function listAssignments({ domain, accessToken, externalCourseId }) {
  const data = await getJson(
    `${baseUrl(domain)}/direct/assignment/site/${encodeURIComponent(externalCourseId)}.json`,
    accessToken,
    LABEL,
  );
  const list = data?.assignment_collection || [];
  return list.filter((a) => a && a.id).map(normalizeAssignment);
}

/* ---- Normalizers: Sakai shape → Summit shared LMS shape ----------------- */

function normalizeCourse(s) {
  return {
    externalId: String(s.id),
    name: s.title || s.entityTitle || s.id,
    code: s.props?.['term'] ? null : (s.shortDescription ?? null),
    term: s.props?.term ?? null,
  };
}

/** Sakai assignment dueTime is { epochSecond } (or `dueTimeString`). maxGradePoint
 *  is in tenths of a point as a string (e.g. "1000" = 100.0). */
function normalizeAssignment(a) {
  let dueDate = null;
  if (a.dueTime?.epochSecond) dueDate = new Date(Number(a.dueTime.epochSecond) * 1000).toISOString();
  else if (a.dueTimeString) dueDate = new Date(a.dueTimeString).toISOString();

  let pointValue = null;
  if (a.gradeScale === 'POINT_GRADE_TYPE' || a.maxGradePoint != null) {
    const raw = Number(a.maxGradePoint);
    if (!Number.isNaN(raw)) pointValue = raw / 10; // tenths → points
  }

  return {
    externalId: String(a.id),
    title: a.title,
    dueDate,
    pointValue,
    description: stripHtml(a.instructions),
    url: a.url ?? null,
    grade: null, // per-student grade requires the submission entity; left for real-cred testing
  };
}
