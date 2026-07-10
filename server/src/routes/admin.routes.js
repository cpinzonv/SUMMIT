import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { adminOnly } from '../middleware/adminOnly.js';
import { validate } from '../middleware/validate.js';
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

// Canvas configuration (admin). GET returns presence flags only (never secrets);
// POST upserts. The token encryption key is write-once (see the service).
router.get('/canvas-config', asyncHandler(admin.getCanvasConfig));
router.post('/canvas-config', validate(admin.canvasConfigSchema), asyncHandler(admin.saveCanvasConfig));

// Institutions (multi-tenancy). Super-admin provisions schools + invite links.
router.get('/institutions', asyncHandler(admin.listInstitutions));
router.post('/institutions', validate(admin.institutionCreateSchema), asyncHandler(admin.createInstitution));
router.get('/institutions/:institutionId', validate(admin.institutionIdParam, 'params'), asyncHandler(admin.getInstitution));
router.patch(
  '/institutions/:institutionId',
  validate(admin.institutionIdParam, 'params'),
  validate(admin.institutionUpdateSchema),
  asyncHandler(admin.updateInstitution),
);
router.post(
  '/institutions/:institutionId/revoke',
  validate(admin.institutionIdParam, 'params'),
  validate(admin.revokeSchema),
  asyncHandler(admin.revokeInstitution),
);

// Premium whitelist — grant comp access to specific users (close friends/testers).
router.get('/whitelist', asyncHandler(admin.whitelistList));
router.post('/whitelist/add', validate(admin.whitelistAddSchema), asyncHandler(admin.whitelistAdd));
router.post('/whitelist/remove', validate(admin.whitelistRemoveSchema), asyncHandler(admin.whitelistRemove));

export default router;
