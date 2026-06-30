import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as gcal from '../controllers/gcal.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/status', asyncHandler(gcal.status));
router.get('/auth-url', asyncHandler(gcal.authUrl));
// Connecting Google Calendar is a Pro feature.
router.post('/connect', requirePremium('googleCalendarSync'), validate(gcal.connectSchema), asyncHandler(gcal.connect));
router.post('/disconnect', asyncHandler(gcal.disconnect));
router.post('/enabled', validate(gcal.enabledSchema), asyncHandler(gcal.setEnabled));

// Push Summit → Google Calendar. POST is canonical; GET accepted for the spec's
// "GET /api/google-calendar/sync".
router.post('/sync', asyncHandler(gcal.sync));
router.get('/sync', asyncHandler(gcal.sync));

export default router;
