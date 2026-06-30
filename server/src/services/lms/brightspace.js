/**
 * Brightspace (D2L) provider.
 *
 * Implements the shared LMS provider interface (see ./index.js) against the
 * D2L Brightspace API. Brightspace is multi-tenant: the API itself is served
 * from the institution host (e.g. "school.brightspace.com"), so each call takes
 * a `domain`. OAuth2, however, is brokered by D2L's central auth server.
 *
 * OAuth2:
 *   authorize: https://auth.brightspace.com/oauth2/auth
 *   token:     https://auth.brightspace.com/core/connect/token   (HTTP Basic)
 *
 * Data (Valence REST on the institution host; versions pinned below):
 *   courses:     GET /d2l/api/lp/{LP}/enrollments/myenrollments/   (Course Offering org units)
 *   course info: GET /d2l/api/lp/{LP}/courses/{orgUnitId}
 *   assignments: GET /d2l/api/le/{LE}/{orgUnitId}/dropbox/folders/  (+ grade via the dropbox/grade objects)
 *
 * MOCK_BRIGHTSPACE_MODE=true (or LMS_MOCK) swaps in the in-memory fixture.
 *
 * Docs: https://docs.valence.desire2learn.com/
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { normalizeHost, requestJson, getJson, stripHtml } from './http.js';

export const name = 'brightspace';
const LABEL = 'Brightspace';
const cfg = () => env.lms.providers.brightspace;

// Pinned Valence API versions. Bump these if the institution requires newer.
const LP = '1.31'; // Learning Platform
const LE = '1.67'; // Learning Environment
const COURSE_OFFERING_TYPE = 3; // org unit type id for a course offering

const AUTH_BASE = 'https://auth.brightspace.com';

export function isConfigured() {
  return Boolean(cfg().clientId && cfg().clientSecret);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'Brightspace is not configured. Set BRIGHTSPACE_CLIENT_ID and BRIGHTSPACE_CLIENT_SECRET in the server environment.',
    );
  }
}

function baseUrl(domain) {
  return normalizeHost(domain, LABEL);
}

export function buildAuthUrl({ redirectUri, state }) {
  assertConfigured();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg().clientId,
    redirect_uri: redirectUri,
    scope: 'core:*:* enrollment:orgunit:read grades:gradeobjects:read',
    state,
  });
  return `${AUTH_BASE}/oauth2/auth?${params.toString()}`;
}

function basicAuthHeader() {
  const creds = Buffer.from(`${cfg().clientId}:${cfg().clientSecret}`).toString('base64');
  return `Basic ${creds}`;
}

async function tokenRequest(form) {
  assertConfigured();
  const data = await requestJson(`${AUTH_BASE}/core/connect/token`, {
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
    throw AppError.badRequest('Brightspace authorization failed: no access token returned.');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

export function exchangeCode({ redirectUri, code }) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refresh({ refreshToken }) {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'core:*:* enrollment:orgunit:read grades:gradeobjects:read',
  });
}

export async function listCourses({ domain, accessToken }) {
  // myenrollments paginates with { Items: [...], PagingInfo: { Bookmark, HasMoreItems } }.
  const items = [];
  let url = `${baseUrl(domain)}/d2l/api/lp/${LP}/enrollments/myenrollments/`;
  for (let page = 0; page < 20 && url; page++) {
    const data = await getJson(url, accessToken, LABEL);
    if (!data) break;
    if (Array.isArray(data.Items)) items.push(...data.Items);
    const more = data.PagingInfo?.HasMoreItems;
    const bookmark = data.PagingInfo?.Bookmark;
    url = more && bookmark
      ? `${baseUrl(domain)}/d2l/api/lp/${LP}/enrollments/myenrollments/?bookmark=${encodeURIComponent(bookmark)}`
      : null;
  }
  return items
    .map((e) => e.OrgUnit)
    .filter((ou) => ou && ou.Type?.Id === COURSE_OFFERING_TYPE)
    .map(normalizeCourse);
}

export async function listAssignments({ domain, accessToken, externalCourseId }) {
  const folders = await getJson(
    `${baseUrl(domain)}/d2l/api/le/${LE}/${encodeURIComponent(externalCourseId)}/dropbox/folders/`,
    accessToken,
    LABEL,
  );
  const list = Array.isArray(folders) ? folders : [];
  return list.filter((f) => f && f.Id != null).map(normalizeAssignment);
}

/* ---- Normalizers: Brightspace shape → Summit shared LMS shape ----------- */

function normalizeCourse(ou) {
  return {
    externalId: String(ou.Id),
    name: ou.Name,
    code: ou.Code ?? null,
    term: null,
  };
}

function normalizeAssignment(f) {
  // D2L dates are ISO 8601 UTC strings. Assessment.ScoreDenominator is the max score.
  const possible = f.Assessment?.ScoreDenominator;
  return {
    externalId: String(f.Id),
    title: f.Name,
    dueDate: f.DueDate ?? null,
    pointValue: possible == null ? null : Number(possible),
    description: stripHtml(f.CustomInstructions?.Html || f.CustomInstructions?.Text),
    url: null,
    grade: null, // grades require a separate grade-object lookup; left for real-cred testing
  };
}
