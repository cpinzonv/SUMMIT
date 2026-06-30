import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as user from '../controllers/user.controller.js';

const router = Router();

router.use(requireAuth);

router.patch(
  '/preferences',
  validate(user.preferencesSchema),
  asyncHandler(user.updatePreferences),
);

export default router;
