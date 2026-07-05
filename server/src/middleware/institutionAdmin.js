import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

/**
 * Gate for /api/institution/* — must run AFTER requireAuth. Only an
 * 'institution_admin' with an institution may proceed, and req.institutionId is
 * stamped from the DB (never the request) so every handler is TENANT-ISOLATED to
 * the caller's own institution.
 */
export async function requireInstitutionAdmin(req, _res, next) {
  try {
    const { rows } = await query('SELECT role, institution_id FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (!u || u.role !== 'institution_admin' || !u.institution_id) {
      return next(AppError.forbidden('Access denied'));
    }
    req.institutionId = u.institution_id;
    next();
  } catch (err) {
    next(err);
  }
}
