import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import * as lmsController from '../controllers/lms.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, sensitiveLimiter, refreshLimiter, accountActionLimiter, waitlistLimiter } from '../middleware/rateLimit.js';
import { registrationGate } from '../middleware/registrationGate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post(
  '/register',
  authLimiter,
  validate(authController.registerSchema),
  // Server-side gate: in invite_only mode, reject signups without a valid
  // invite code / allowlisted email (403 REGISTRATION_CLOSED). Runs regardless
  // of what the client shows. Login/reset/existing-account flows are untouched.
  asyncHandler(registrationGate),
  asyncHandler(authController.register),
);

// Public launch waitlist (shown while registration is invite_only).
router.post(
  '/waitlist',
  waitlistLimiter,
  validate(authController.waitlistSchema),
  asyncHandler(authController.joinWaitlist),
);

router.post(
  '/login',
  sensitiveLimiter,
  validate(authController.loginSchema),
  asyncHandler(authController.login),
);

router.post(
  '/verify-email',
  authLimiter,
  validate(authController.verifyEmailSchema),
  asyncHandler(authController.verifyEmail),
);
router.post(
  '/resend-verification',
  authLimiter,
  validate(authController.resendVerificationSchema),
  asyncHandler(authController.resendVerification),
);

router.post(
  '/forgot-password',
  sensitiveLimiter,
  validate(authController.forgotPasswordSchema),
  asyncHandler(authController.forgotPassword),
);
router.post(
  '/reset-password',
  sensitiveLimiter,
  validate(authController.resetPasswordSchema),
  asyncHandler(authController.resetPassword),
);

// Second step when the account has 2FA enabled — strict to throttle code guessing.
router.post(
  '/login/2fa',
  sensitiveLimiter,
  validate(authController.login2faSchema),
  asyncHandler(authController.loginTwoFactor),
);

router.post(
  '/refresh',
  refreshLimiter,
  validate(authController.refreshSchema),
  asyncHandler(authController.refresh),
);

router.post(
  '/logout',
  refreshLimiter,
  validate(authController.refreshSchema),
  asyncHandler(authController.logout),
);

// Sign out everywhere (authenticated) — per-account rate limited.
router.post(
  '/logout-all',
  requireAuth,
  accountActionLimiter,
  asyncHandler(authController.logoutAll),
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
  sensitiveLimiter,
  validate(authController.changePasswordSchema),
  asyncHandler(authController.changePassword),
);

// Public invite links — institution admins set their password to activate.
router.get('/invite/:token', asyncHandler(authController.getInvite));
router.post(
  '/invite/:token/accept',
  validate(authController.acceptInviteSchema),
  asyncHandler(authController.acceptInvite),
);

export default router;
