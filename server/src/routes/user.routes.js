import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as user from '../controllers/user.controller.js';

const router = Router();

router.use(requireAuth);

router.patch(
  '/preferences',
  validate(user.preferencesSchema),
  asyncHandler(user.updatePreferences),
);

// Graduation requirements (total credits + optional per-semester target).
router.get('/graduation-settings', asyncHandler(user.getGraduationSettings));
router.patch(
  '/graduation-settings',
  validate(user.graduationSettingsSchema),
  asyncHandler(user.updateGraduationSettings),
);

// Two-factor authentication setup/management (the user is authenticated).
// Confirm/disable verify a code or password, so throttle them (code guessing).
router.post('/2fa/setup', asyncHandler(user.twofaSetup));
router.post('/2fa/confirm', sensitiveLimiter, validate(user.twofaConfirmSchema), asyncHandler(user.twofaConfirm));
router.post('/2fa/disable', sensitiveLimiter, validate(user.twofaDisableSchema), asyncHandler(user.twofaDisable));
// Regenerate backup codes (bcrypt-hashed). Password re-auth + throttled.
router.post('/2fa/backup-codes', sensitiveLimiter, validate(user.twofaBackupCodesSchema), asyncHandler(user.twofaBackupCodes));

// Trusted devices ("remember this device" for 2FA) — list + revoke.
router.get('/trusted-devices', asyncHandler(user.listDevices));
router.delete('/trusted-devices', asyncHandler(user.revokeAllDevices));
router.delete('/trusted-devices/:deviceId', validate(user.deviceIdParam, 'params'), asyncHandler(user.revokeDevice));

// Account security & recovery — phone (SMS), backup email, change primary email.
router.post('/phone', validate(user.phoneSchema), asyncHandler(user.addPhone));
router.post('/phone/verify', validate(user.phoneVerifySchema), asyncHandler(user.verifyPhone));
router.delete('/phone', asyncHandler(user.removePhone));

router.post('/recovery-email', validate(user.recoveryEmailSchema), asyncHandler(user.addRecoveryEmail));
router.post('/recovery-email/verify', validate(user.recoveryEmailVerifySchema), asyncHandler(user.verifyRecoveryEmail));
router.delete('/recovery-email', asyncHandler(user.removeRecoveryEmail));

router.post('/email/change', validate(user.emailChangeSchema), asyncHandler(user.requestEmailChange));
router.post('/email/change/verify', validate(user.emailChangeVerifySchema), asyncHandler(user.verifyEmailChange));

// Danger Zone: soft-delete the account (30-day recovery grace, then purge).
// Re-auth + email confirmation are enforced in the service; throttle it.
router.post('/account/delete', sensitiveLimiter, validate(user.deleteAccountSchema), asyncHandler(user.deleteAccount));

export default router;
