import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import * as lmsController from '../controllers/lms.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post(
  '/register',
  validate(authController.registerSchema),
  asyncHandler(authController.register),
);

router.post(
  '/login',
  validate(authController.loginSchema),
  asyncHandler(authController.login),
);

// Second step when the account has 2FA enabled.
router.post(
  '/login/2fa',
  validate(authController.login2faSchema),
  asyncHandler(authController.loginTwoFactor),
);

// Password reset — both are public (the user can't log in). forgot-password is
// rate-limited per email inside the service; reset-password validates the token.
router.post(
  '/forgot-password',
  validate(authController.forgotPasswordSchema),
  asyncHandler(authController.forgotPassword),
);

router.post(
  '/reset-password',
  validate(authController.resetPasswordSchema),
  asyncHandler(authController.resetPassword),
);

router.post(
  '/refresh',
  validate(authController.refreshSchema),
  asyncHandler(authController.refresh),
);

router.post(
  '/logout',
  validate(authController.refreshSchema),
  asyncHandler(authController.logout),
);

// Canvas OAuth callback: the authenticated user exchanges the code Canvas sent
// back for tokens. (The rest of the Canvas API lives under /api/canvas.)
router.post(
  '/canvas/callback',
  requireAuth,
  validate(lmsController.callbackSchema),
  asyncHandler(lmsController.callback),
);

router.get('/me', requireAuth, asyncHandler(authController.me));

router.patch(
  '/password',
  requireAuth,
  validate(authController.changePasswordSchema),
  asyncHandler(authController.changePassword),
);

export default router;
