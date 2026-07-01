import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { adminOnly } from '../middleware/adminOnly.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as admin from '../controllers/admin.controller.js';
import * as authController from '../controllers/auth.controller.js';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

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

// Premium whitelist — grant comp access to specific users (close friends/testers).
router.get('/whitelist', asyncHandler(admin.whitelistList));
router.post('/whitelist/add', validate(admin.whitelistAddSchema), asyncHandler(admin.whitelistAdd));
router.post('/whitelist/remove', validate(admin.whitelistRemoveSchema), asyncHandler(admin.whitelistRemove));

// TEMPORARY — run db:seed on the production server. Remove once admin account is created.
router.post('/seed-database', asyncHandler(async (req, res) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const seedScript = path.resolve(__dirname, '../../db/seed.js');
    execFile('node', [seedScript], { cwd: path.resolve(__dirname, '../..') }, (err, stdout, stderr) => {
          if (err) {
                  return res.status(500).json({ ok: false, error: err.message, stderr });
          }
          res.json({ ok: true, stdout, stderr });
    });
}));

export default router;
