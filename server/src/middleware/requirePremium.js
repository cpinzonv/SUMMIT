import { AppError } from '../utils/AppError.js';
import { getUserGating, canAccessFeature, getFeatureStatus } from '../services/featureGating.service.js';

/**
 * Gate an endpoint behind a named premium feature. Must run AFTER requireAuth.
 * Access is decided by featureGating.canAccessFeature (admin/demo always; paying
 * subscribers when BILLING_ENABLED). Reads the user from the DB so an upgrade or
 * role change takes effect immediately.
 *
 *   router.post('/podcasts/generate', requirePremium('podcasts'), handler)
 */
export function requirePremium(featureName) {
  return async (req, res, next) => {
    try {
      const u = await getUserGating(req.user.id);
      if (canAccessFeature(u, featureName)) return next();
      const { message } = getFeatureStatus(u, featureName);
      return next(new AppError(403, message || 'Upgrade to Pro to use this feature.', {
        code: 'premium_required',
        feature: featureName,
      }));
    } catch (err) {
      return next(err);
    }
  };
}
