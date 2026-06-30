import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

/**
 * Gate for /api/admin/* — must run AFTER requireAuth (which sets req.user.id).
 * Looks up the user's role; only 'admin' may proceed, else 403. The role is
 * read from the DB (not the access token) so a demotion takes effect at once.
 */
export async function adminOnly(req, res, next) {
  try {
    const { rows } = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (rows[0]?.role === 'admin') return next();
    return next(AppError.forbidden('Access denied'));
  } catch (err) {
    return next(err);
  }
}
