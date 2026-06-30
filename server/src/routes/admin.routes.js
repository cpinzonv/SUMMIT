import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { adminOnly } from '../middleware/adminOnly.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as admin from '../controllers/admin.controller.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

// First-admin bootstrap — token-gated, self-disables once an admin exists.
// Intentionally NOT behind requireAuth/adminOnly so the first admin can be made.
router.post('/bootstrap', asyncHandler(admin.bootstrap));

// Everything else is admin-only (requireAuth then a DB role check).
router.use(requireAuth, adminOnly);

router.get('/analytics/overview', asyncHandler(admin.overview));
router.get('/analytics/signups', asyncHandler(admin.signups));
router.get('/analytics/referrals', asyncHandler(admin.referrals));
router.get('/analytics/activity', asyncHandler(admin.activity));
router.get('/analytics/lms', asyncHandler(admin.lms));
// Back-compat: the original referral-sources endpoint (now admin-gated).
router.get('/analytics/referral-sources', asyncHandler(authController.referralAnalytics));

export default router;
