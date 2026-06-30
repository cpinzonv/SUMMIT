/**
 * Canvas LMS provider.
 *
 * Implements the shared LMS provider interface (see ./index.js): OAuth2
 * (authorize → exchange → refresh) plus course/assignment listing, with every
 * response normalized into Summit's shared LMS shape so the sync service is
 * provider-agnostic. Other LMSs (Blackboard, Brightspace, Moodle) implement the
 * same interface and drop into the registry.
 *
 * Canvas is multi-tenant: each institution has its own host (e.g.
 * "asu.instructure.com"), so every call takes a `domain`.
 *
 * API docs: https://canvas.instructure.com/doc/api/
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

export const name = 'canvas';

/** Read scopes we request. Canvas only enforces these if the dev key is scoped. */
const SCOPES = [
  'url:GET|/api/v1/courses',
  'url:GET|/api/v1/courses/:course_id/assignments',
].join(' ');

export function isConfigured() {
  return Boolean(env.lms.canvas.clientId && env.lms.canvas.clientSecret);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'Canvas is not configured. Set CANVAS_CLIENT_ID and CANVAS_CLIENT_SECRET in the server environment.',
    );
  }
}

function baseUrl(domain) {
  // Accept "asu.instructure.com" or "https://asu.instructure.com" and normalize.
  const host = String(domain).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    throw AppError.badRequest('Enter a valid Canvas domain, e.g. "school.instructure.com".');
  }
  return `https://${host}`;
}

/** Step 1: the URL we send the user to in order to grant access. */
export function buildAuthUrl({ domain, redirectUri, state }) {
  assertConfigured();
  const params = new URLSearchParams({
    client_id: env.lms.canvas.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: SCOPES,
  });
  return `${baseUrl(domain)}/login/oauth2/auth?${params.toString()}`;
}

async function tokenRequest(domain, body) {
  assertConfigured();
  let res;
  try {
    res = await fetch(`${baseUrl(domain)}/login/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.lms.canvas.clientId,
        client_secret: env.lms.canvas.clientSecret,
        ...body,
      }),
    });
  } catch (err) {
    throw new AppError(502, `Could not reach Canvas: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Canvas returns { error, error_description } on OAuth failures.
    const msg = data.error_description || data.error || `Canvas token request failed (${res.status})`;
    throw AppError.badRequest(`Canvas authorization failed: ${msg}`);
  }
  return {
    accessToken: data.access_token,
    // Canvas only returns refresh_token on the initial code exchange.
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
  };
}

/** Step 2: exchange the authorization code for tokens. */
export function exchangeCode({ domain, redirectUri, code }) {
  return tokenRequest(domain, {
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
}

/** Refresh an expired access token (refresh token stays valid). */
export function refresh({ domain, refreshToken }) {
  return tokenRequest(domain, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

/**
 * Authenticated GET against the Canvas REST API, following pagination Link
 * headers (capped). Maps auth/rate-limit failures to typed AppErrors the sync
 * service understands.
 */
async function canvasGet(domain, accessToken, path) {
  const results = [];
  let url = `${baseUrl(domain)}${path}`;
  for (let page = 0; page < 20 && url; page++) {
    let res;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    } catch (err) {
      throw new AppError(502, `Could not reach Canvas: ${err.message}`);
    }

    if (res.status === 401) {
      // Token expired/revoked — caller may refresh and retry.
      throw new AppError(401, 'Canvas access token expired', { code: 'lms_token_expired' });
    }
    // Canvas signals throttling with 403 + "Rate Limit Exceeded".
    const remaining = res.headers.get('x-rate-limit-remaining');
    if (res.status === 403) {
      const text = await res.text().catch(() => '');
      if (/rate limit/i.test(text) || remaining === '0') {
        throw new AppError(429, 'Canvas rate limit reached. Try again in a few minutes.', {
          code: 'lms_rate_limited',
        });
      }
      throw AppError.forbidden('Canvas denied access to this resource.');
    }
    if (!res.ok) {
      throw new AppError(502, `Canvas API error (${res.status}).`);
    }

    const page_data = await res.json().catch(() => null);
    if (Array.isArray(page_data)) results.push(...page_data);
    else if (page_data) results.push(page_data);

    url = parseNextLink(res.headers.get('link'));
  }
  return results;
}

/** Extract the rel="next" URL from a Canvas Link header, if present. */
function parseNextLink(link) {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export async function listCourses({ domain, accessToken }) {
  const raw = await canvasGet(
    domain,
    accessToken,
    '/api/v1/courses?enrollment_state=active&per_page=100&include[]=term',
  );
  return raw.filter((c) => c && c.id && c.name).map(normalizeCourse);
}

export async function listAssignments({ domain, accessToken, externalCourseId }) {
  const raw = await canvasGet(
    domain,
    accessToken,
    `/api/v1/courses/${externalCourseId}/assignments?per_page=100&include[]=submission`,
  );
  return raw.filter((a) => a && a.id).map(normalizeAssignment);
}

/* ---- Normalizers: Canvas shape → Summit shared LMS shape ---------------- */

function normalizeCourse(c) {
  return {
    externalId: String(c.id),
    name: c.name,
    code: c.course_code ?? null,
    term: c.term?.name ?? null,
  };
}

function normalizeAssignment(a) {
  const sub = a.submission;
  // Only treat a submission as a grade when it has actually been scored.
  const grade =
    sub && sub.score != null && a.points_possible
      ? { pointsEarned: Number(sub.score), pointsPossible: Number(a.points_possible) }
      : null;
  return {
    externalId: String(a.id),
    title: a.name,
    dueDate: a.due_at ?? null, // already ISO 8601 from Canvas
    pointValue: a.points_possible == null ? null : Number(a.points_possible),
    description: stripHtml(a.description),
    url: a.html_url ?? null,
    grade,
  };
}

/** Canvas assignment descriptions are HTML; reduce to readable plain text. */
function stripHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}
