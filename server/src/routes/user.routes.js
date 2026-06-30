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

// Two-factor authentication setup/management (the user is authenticated).
router.post('/2fa/setup', asyncHandler(user.twofaSetup));
router.post('/2fa/confirm', validate(user.twofaConfirmSchema), asyncHandler(user.twofaConfirm));
router.post('/2fa/disable', validate(user.twofaDisableSchema), asyncHandler(user.twofaDisable));

export default router;
