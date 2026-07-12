import { AppError } from '../utils/AppError.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { query } from '../config/db.js';

/**
 * Require a valid Bearer access token. On success, attaches { id } to req.user
 * so downstream handlers can scope queries to the authenticated student.
 *
 * Beyond signature verification, the token is checked against the user's
 * `sessions_invalidated_at` watermark (M1): a token whose `iat` predates a
 * logout-all / password change / reset is rejected on the very next request,
 * closing the ~15-min blind spot that a signature-only check left open.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing Bearer token'));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(AppError.unauthorized('Invalid or expired token'));
  }

  try {
    const { rows } = await query('SELECT sessions_invalidated_at, deleted_at FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0]) return next(AppError.unauthorized('Invalid or expired token'));
    const watermark = rows[0].sessions_invalidated_at;
    // JWT `iat` is in whole seconds. Reject tokens minted before the watermark.
    if (watermark && typeof payload.iat === 'number' && payload.iat < Math.floor(new Date(watermark).getTime() / 1000)) {
      return next(AppError.unauthorized('Session was ended — please sign in again.'));
    }
    // Defense in depth: a soft-deleted account is deactivated and cannot use the
    // API normally. Its sessions are revoked at deletion time, so a live token
    // here is an edge case — refuse it with a code the client routes to Restore.
    // (The Restore endpoint uses a dedicated restore token, not requireAuth.)
    if (rows[0].deleted_at) {
      return next(new AppError(403, 'Your account is scheduled for deletion.', { code: 'ACCOUNT_PENDING_DELETION' }));
    }
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    next(err);
  }
}
