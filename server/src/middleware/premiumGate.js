import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

/**
 * Gate premium Learn formats (quizzes, podcasts, study guides, mind maps).
 * Flashcards stay free. Must run AFTER requireAuth. Plan/role are read from the
 * DB (not the token) so an upgrade/downgrade takes effect immediately. Admins
 * are treated as pro. No billing system yet — promote with
 *   UPDATE users SET plan='pro' WHERE email='...';
 */
export async function premiumGate(req, res, next) {
  try {
    const { rows } = await query('SELECT plan, role FROM users WHERE id = $1', [req.user.id]);
    const u = rows[0];
    if (u && (u.plan === 'pro' || u.role === 'admin')) return next();
    return next(
      new AppError(403, 'Upgrade to Pro to use quizzes, podcasts, study guides, and mind maps.', {
        code: 'premium_required',
      }),
    );
  } catch (err) {
    return next(err);
  }
}
