/**
 * Institution-admin API (school IT). Mounted at /api/institution. Tenant-isolated
 * to the caller's own institution via requireInstitutionAdmin.
 *   GET  /            institution + student roster
 *   POST /roster      bulk-provision students (returns invite tokens)
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireInstitutionAdmin } from '../middleware/institutionAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as ctrl from '../controllers/institutionAdmin.controller.js';

const router = Router();
router.use(requireAuth, requireInstitutionAdmin);

router.get('/', asyncHandler(ctrl.overview));
router.post('/roster', validate(ctrl.rosterSchema), asyncHandler(ctrl.uploadRoster));

export default router;
