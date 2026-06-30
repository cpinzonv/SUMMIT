import { AppError } from '../utils/AppError.js';
import { getUserGating, hasPremiumAccess } from '../services/featureGating.service.js';

/**
 * Gate premium Learn formats (quizzes, podcasts, study guides, mind maps).
 * Flashcards stay free. Must run AFTER requireAuth. Access is decided by
 * featureGating.hasPremiumAccess (admin/demo/is_premium/active-pro), read from
 * the DB so an upgrade/downgrade takes effect immediately. No billing yet —
 * grant access with: UPDATE users SET is_premium=true WHERE email='...';
 */
export async function premiumGate(req, res, next) {
  try {
    const u = await getUserGating(req.user.id);
    if (hasPremiumAccess(u)) return next();
    return next(
      new AppError(403, 'Upgrade to Pro to use quizzes, podcasts, study guides, and mind maps.', {
        code: 'premium_required',
      }),
    );
  } catch (err) {
    return next(err);
  }
}
