import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

// Admin / analytics endpoints. Auth-protected; there is no role system yet, so
// any signed-in user can read these aggregate, non-PII counts (future use).
router.use(requireAuth);

router.get('/analytics/referral-sources', asyncHandler(authController.referralAnalytics));

export default router;
