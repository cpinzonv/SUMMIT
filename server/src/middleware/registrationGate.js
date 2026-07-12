import { AppError } from '../utils/AppError.js';
import { isRegistrationOpen, isEmailAllowed, findValidInviteCode } from '../services/registration.service.js';

/**
 * Server-side gate for POST /auth/register. Enforced regardless of what the
 * client renders: in invite_only mode a request must carry a valid invite code
 * OR an allowlisted email, otherwise 403 with code REGISTRATION_CLOSED.
 *
 * The mode is read (cached) from the admin-controlled app_settings, so an admin
 * flipping it takes effect here without a redeploy; it fails closed on any read
 * problem. Runs after validate() (so req.body.email/inviteCode are shaped). The
 * invite code is only *validated* here; it is *consumed* in the register
 * service, and only when an account is actually created — a failed or
 * already-registered signup never burns a use.
 */
export async function registrationGate(req, res, next) {
  try {
    if (await isRegistrationOpen()) return next();

    const { inviteCode, email } = req.body || {};
    if (inviteCode && (await findValidInviteCode(inviteCode))) return next();
    if (isEmailAllowed(email)) return next();

    return next(new AppError(403, 'Registration is currently invite-only.', { code: 'REGISTRATION_CLOSED' }));
  } catch (err) {
    return next(err);
  }
}
