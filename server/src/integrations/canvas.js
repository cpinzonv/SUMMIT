/**
 * Canvas LMS REST client (admin-API-key flavor).
 *
 * This is the token-based integration configured once by an admin (base URL +
 * API access token, stored encrypted in lms_credentials). It is intentionally
 * separate from services/lms/canvas.js, which is the per-user OAuth flow.
 *
 * The access token is user-scoped on Canvas's side, so most calls don't need a
 * user id — the token identifies the caller. Grades are the exception (we can
 * pass a Canvas user id to scope an enrollment lookup).
 *
 * Docs: https://canvas.instructure.com/doc/api/
 *   GET /api/v1/courses
 *   GET /api/v1/courses/:course_id/assignments
 *   GET /api/v1/courses/:course_id/enrollments
 */
import { decrypt } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';

// --- Rate limiting ----------------------------------------------------------
// Canvas uses a leaky-bucket limiter and 403s / 429s aggressive callers. We're
// low-volume, so a per-host serialized queue with a small minimum gap between
// requests keeps us comfortably under the limit without extra deps.
const MIN_REQUEST_GAP_MS = 120;
const hostQueues = new Map(); // host -> { chain: Promise, last: number }

function throttle(host) {
  const q = hostQueues.get(host) || { chain: Promise.resolve(), last: 0 };
  const run = q.chain.then(async () => {
    const wait = Math.max(0, q.last + MIN_REQUEST_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    q.last = Date.now();
  });
  q.chain = run.catch(() => {}); // keep the chain alive even if a call rejects
  hostQueues.set(host, q);
  return run;
}

// --- URL helpers ------------------------------------------------------------
/** Normalize an institution base URL to `https://host` (no trailing slash/path). */
export function normalizeBaseUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw AppError.badRequest('Canvas base URL is required.');
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw AppError.badRequest('Canvas base URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw AppError.badRequest('Canvas base URL must use https.');
  }
  return `${url.protocol}//${url.host}`;
}

export class CanvasClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl        Institution base URL, e.g. https://school.instructure.com
   * @param {string} [opts.encryptedApiKey] AES-256-GCM payload (from lms_credentials); decrypted lazily.
   * @param {string} [opts.apiKey]        Plaintext token (used by verify-before-store, tests).
   */
  constructor({ baseUrl, encryptedApiKey, apiKey }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this._encryptedApiKey = encryptedApiKey || null;
    this._apiKey = apiKey || null; // decrypted lazily from _encryptedApiKey if absent
  }

  /** Decrypt the token on demand; never stored back in plaintext beyond this call's lifetime. */
  get #token() {
    if (this._apiKey) return this._apiKey;
    if (!this._encryptedApiKey) throw AppError.badRequest('No Canvas API key configured.');
    const value = decrypt(this._encryptedApiKey);
    if (!value) throw new AppError(500, 'Stored Canvas API key could not be read.');
    return value;
  }

  /**
   * Perform a rate-limited, authenticated GET against the Canvas API and map
   * failures to clear AppErrors. `path` starts with `/api/v1/...`.
   */
  async #get(path) {
    const url = `${this.baseUrl}${path}`;
    const host = new URL(this.baseUrl).host;
    await throttle(host);

    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'Could not reach Canvas. Check the base URL and try again.');
    }

    if (res.status === 401) throw AppError.badRequest('Canvas rejected the API key (unauthorized). Check the access token.');
    if (res.status === 403) throw AppError.badRequest('Canvas denied the request (forbidden or rate limited). Try again shortly.');
    if (res.status === 404) throw AppError.notFound('That Canvas resource was not found. Check the course ID.');
    if (res.status === 429) throw new AppError(429, 'Canvas rate limit reached. Please try again in a moment.');
    if (!res.ok) throw new AppError(502, `Canvas returned an unexpected error (HTTP ${res.status}).`);

    try {
      return await res.json();
    } catch {
      throw new AppError(502, 'Canvas returned a response we could not read.');
    }
  }

  /** Test the credentials by listing one course. Returns { ok, courseCount }. */
  async verifyConnection() {
    const courses = await this.#get('/api/v1/courses?per_page=1');
    return { ok: true, courseCount: Array.isArray(courses) ? courses.length : 0 };
  }

  /**
   * Active courses for the token's user. `userCanvasId` is accepted for API
   * symmetry but Canvas scopes /courses to the token holder already.
   */
  async getCourses(/* userCanvasId */) {
    const courses = await this.#get('/api/v1/courses?enrollment_state=active&per_page=100');
    return Array.isArray(courses) ? courses : [];
  }

  /** Fetch a single course by id (used to validate a link target). 404s if missing. */
  async getCourse(courseId) {
    if (!courseId) throw AppError.badRequest('A Canvas course ID is required.');
    return this.#get(`/api/v1/courses/${encodeURIComponent(courseId)}`);
  }

  /** Assignments for a course. */
  async getAssignments(courseId) {
    if (!courseId) throw AppError.badRequest('A Canvas course ID is required.');
    const list = await this.#get(`/api/v1/courses/${encodeURIComponent(courseId)}/assignments?per_page=100`);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Per-assignment submissions for a course, scoped to one student (defaults to
   * `self` — the token owner, which is what a personal access token can read).
   * Includes the assignment so we can capture points_possible. Each item:
   * { assignment_id, score, submitted_at, assignment: { points_possible, name } }.
   */
  async getSubmissions(courseId, studentId = 'self') {
    if (!courseId) throw AppError.badRequest('A Canvas course ID is required.');
    const q = new URLSearchParams({ per_page: '100', 'include[]': 'assignment' });
    q.append('student_ids[]', String(studentId));
    const subs = await this.#get(
      `/api/v1/courses/${encodeURIComponent(courseId)}/students/submissions?${q}`,
    );
    return Array.isArray(subs) ? subs : [];
  }

  /**
   * Grades for a course via enrollments. Optionally scope to one Canvas user id;
   * returns each enrollment's `grades` block (current/final score + grade).
   */
  async getGrades(courseId, userId) {
    if (!courseId) throw AppError.badRequest('A Canvas course ID is required.');
    const q = new URLSearchParams({ per_page: '100', 'type[]': 'StudentEnrollment' });
    if (userId) q.set('user_id', String(userId));
    const enrollments = await this.#get(`/api/v1/courses/${encodeURIComponent(courseId)}/enrollments?${q}`);
    return (Array.isArray(enrollments) ? enrollments : []).map((e) => ({
      userId: e.user_id,
      grades: e.grades ?? null,
    }));
  }
}
