import { AppError } from '../utils/AppError.js';
import { verifyAccessToken } from '../utils/jwt.js';

/**
 * Require a valid Bearer access token. On success, attaches { id } to req.user
 * so downstream handlers can scope queries to the authenticated student.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing Bearer token'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    next();
  } catch {
    next(AppError.unauthorized('Invalid or expired token'));
  }
}
