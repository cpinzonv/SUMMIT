/**
 * /api/billing — fake-door paywall, founding members, waitlist, gate analytics.
 * Everything is auth'd; /admin/* additionally requires the admin role.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { adminOnly } from '../middleware/adminOnly.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as billing from '../controllers/billing.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/status', asyncHandler(billing.status));
router.post('/claim-founding', asyncHandler(billing.claimFounding));
router.post('/waitlist', validate(billing.waitlistSchema), asyncHandler(billing.joinWaitlist));
router.post('/gate-event', validate(billing.gateEventSchema), asyncHandler(billing.gateEvent));
router.post('/checkout', asyncHandler(billing.checkout)); // stub — 501 (see controller TODO)

// ---- admin (monetization panel) --------------------------------------------
router.get('/admin/flags', adminOnly, asyncHandler(billing.adminFlags));
router.patch('/admin/flags', adminOnly, validate(billing.setFlagSchema), asyncHandler(billing.adminSetFlag));
router.get('/admin/founding', adminOnly, asyncHandler(billing.adminFounding));
router.get('/admin/waitlist', adminOnly, asyncHandler(billing.adminWaitlist));
router.get('/admin/waitlist.csv', adminOnly, asyncHandler(billing.adminWaitlistCsv));
router.get('/admin/gate-analytics', adminOnly, asyncHandler(billing.adminGateAnalytics));

export default router;
