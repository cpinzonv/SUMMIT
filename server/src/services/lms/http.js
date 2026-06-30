/**
 * Small HTTP helpers shared by the real LMS provider modules.
 *
 * They centralize the error mapping the sync service relies on:
 *   - network failure            → AppError 502 "Could not reach <label>"
 *   - 401 / invalid_token        → AppError 401 { code: 'lms_token_expired' }
 *                                  (so withValidToken() refreshes once and retries)
 *   - 429 / rate limit           → AppError 429 { code: 'lms_rate_limited' }
 *   - other non-2xx              → AppError 502 "<label> API error (status)"
 *
 * Mock mode never reaches this file (the mock provider returns fixtures), so
 * these helpers only run against real institutions.
 */
import { AppError } from '../../utils/AppError.js';

/** Normalize "school.edu" or "https://school.edu/" → "https://school.edu". */
export function normalizeHost(domain, label = 'LMS') {
  const host = String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    throw AppError.badRequest(`Enter a valid ${label} web address, e.g. "school.edu".`);
  }
  return `https://${host}`;
}

/** Authenticated JSON request. Returns parsed body (or null). Maps errors. */
export async function requestJson(url, { method = 'GET', headers = {}, body, label = 'LMS' } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (err) {
    throw new AppError(502, `Could not reach ${label}: ${err.message}`);
  }

  if (res.status === 401) {
    throw new AppError(401, `${label} access token expired`, { code: 'lms_token_expired' });
  }
  if (res.status === 429) {
    throw new AppError(429, `${label} rate limit reached. Try again in a few minutes.`, {
      code: 'lms_rate_limited',
    });
  }
  if (res.status === 403) {
    const text = await res.text().catch(() => '');
    if (/rate.?limit/i.test(text)) {
      throw new AppError(429, `${label} rate limit reached. Try again in a few minutes.`, {
        code: 'lms_rate_limited',
      });
    }
    throw AppError.forbidden(`${label} denied access to this resource.`);
  }
  if (!res.ok) {
    throw new AppError(502, `${label} API error (${res.status}).`);
  }
  return res.json().catch(() => null);
}

/** Bearer GET returning JSON. */
export function getJson(url, accessToken, label = 'LMS') {
  return requestJson(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, label });
}

/** Reduce HTML (some LMS descriptions are HTML) to readable plain text. */
export function stripHtml(html) {
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
