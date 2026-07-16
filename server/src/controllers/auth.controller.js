import { z } from 'zod';
import { logSecurityEvent } from '../services/audit.service.js';
import * as authService from '../services/auth.service.js';
import * as registrationService from '../services/registration.service.js';

// Allowed "How'd you hear about us?" values (kept in sync with the client form).
export const REFERRAL_SOURCES = [
  'friend',
  'google_search',
  'social_media',
  'school',
  'app_store',
  'other',
];

// Invite-link onboarding (institution admins set their password here).
export const acceptInviteSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export async function getInvite(req, res) {
  res.json(await authService.getInvite(req.params.token));
}
export async function acceptInvite(req, res) {
  res.json(await authService.acceptInvite({ token: req.params.token, password: req.body.password }));
}

export const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required'),
  school: z.string().optional(),
  timezone: z.string().optional(),
  referralSource: z.enum(REFERRAL_SOURCES).optional(),
  referralSourceDetail: z.string().max(200).optional(),
  // Gated registration (invite_only mode): an invite code from the signup form
  // or the ?invite= link. Validated by registrationGate, consumed on success.
  inviteCode: z.string().trim().max(64).optional(),
});

// Public waitlist signup (shown while registration is invite_only).
export const waitlistSchema = z.object({
  email: z.string().email().toLowerCase(),
  university: z.string().trim().max(200).optional(),
  source: z.string().trim().max(60).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
  // A remembered-device token (from a prior "trust this device") that lets a
  // 2FA account skip the second step from this browser.
  deviceToken: z.string().max(256).optional(),
});

export const login2faSchema = z.object({
  challengeToken: z.string().min(1, 'challengeToken is required'),
  code: z.string().min(1, 'Enter your authentication code'),
  // "Trust this device for 30 days" — skip 2FA on this browser next time.
  trustDevice: z.boolean().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const verifyEmailSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().min(1, 'Enter the code we emailed you'),
});
export const resendVerificationSchema = z.object({
  email: z.string().email().toLowerCase(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
  method: z.enum(['email', 'recovery_email', 'sms']).optional(),
});
export const resetPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().min(1, 'Enter the code we sent you'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

/** Signup attribution analytics (admin/future use). */
export async function referralAnalytics(req, res) {
  res.json({ sources: await authService.referralSourceCounts() });
}

export async function register(req, res) {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

/** Join the launch waitlist. Duplicate emails upsert silently (see service). */
export async function joinWaitlist(req, res) {
  await registrationService.addToWaitlist({
    email: req.body.email,
    university: req.body.university,
    source: req.body.source || 'register_page',
  });
  res.status(201).json({ ok: true });
}

export async function verifyEmail(req, res) {
  res.json(await authService.verifyEmail(req.body));
}

export async function resendVerification(req, res) {
  res.json(await authService.resendVerification(req.body));
}

export async function forgotPassword(req, res) {
  res.json(await authService.requestPasswordReset(req.body));
}

export async function resetPassword(req, res) {
  const result = await authService.resetPassword(req.body);
  await logSecurityEvent({ action: 'password_reset', outcome: 'success', email: req.body.email, ip: req.ip });
  res.json(result);
}

export async function login(req, res) {
  let result;
  try {
    result = await authService.login({ ...req.body, userAgent: req.get('user-agent'), ip: req.ip });
  } catch (err) {
    // Record the failed attempt (bad credentials / locked, etc.) then rethrow.
    await logSecurityEvent({ action: 'login', outcome: 'failure', email: req.body.email, ip: req.ip });
    throw err;
  }
  // A verification/2FA challenge isn't a completed login; log only token issuance.
  if (result?.user) {
    await logSecurityEvent({ action: 'login', outcome: 'success', userId: result.user.id, email: result.user.email, ip: req.ip });
  }
  res.json(result);
}

export async function loginTwoFactor(req, res) {
  const result = await authService.loginTwoFactor({ ...req.body, userAgent: req.get('user-agent'), ip: req.ip });
  if (result?.user) {
    await logSecurityEvent({ action: 'login_2fa', outcome: 'success', userId: result.user.id, email: result.user.email, ip: req.ip });
  }
  res.json(result);
}

export async function refresh(req, res) {
  const result = await authService.refresh(req.body);
  res.json(result);
}

export async function logout(req, res) {
  const { userId } = await authService.logout(req.body);
  // The endpoint is unauthenticated (identity comes from the token record), so
  // only audit when a live token was actually revoked.
  if (userId) await logSecurityEvent({ action: 'logout', outcome: 'success', userId, ip: req.ip });
  res.status(204).end();
}

// "Log out of all devices" — sensitive, so it re-authenticates first.
export const logoutAllSchema = z.object({
  password: z.string().optional(),
  totpCode: z.string().optional(),
});

/**
 * Sign out everywhere: re-auth with the current password (+ 2FA code if on),
 * then revoke ALL of the caller's refresh tokens + trusted devices and stamp the
 * access-token watermark. The current device is logged out too.
 */
export async function logoutAll(req, res) {
  try {
    await authService.verifyReauth(req.user.id, { password: req.body.password, totpCode: req.body.totpCode });
  } catch (err) {
    await logSecurityEvent({ action: 'logout_all', outcome: 'failure', userId: req.user.id, ip: req.ip });
    throw err;
  }
  await authService.logoutAll(req.user.id);
  await logSecurityEvent({ action: 'logout_all', outcome: 'success', userId: req.user.id, ip: req.ip });
  res.json({ ok: true });
}

export async function me(req, res) {
  const user = await authService.getCurrentUser(req.user.id);
  res.json({ user });
}

export async function changePassword(req, res) {
  let tokens;
  try {
    // Ends all OTHER sessions and returns a fresh pair for THIS one, carrying the
    // caller's device context onto the new refresh token.
    tokens = await authService.changePassword(
      req.user.id,
      req.body.currentPassword,
      req.body.newPassword,
      { userAgent: req.get('user-agent'), ip: req.ip },
    );
  } catch (err) {
    await logSecurityEvent({ action: 'password_change', outcome: 'failure', userId: req.user.id, ip: req.ip });
    throw err;
  }
  await logSecurityEvent({ action: 'password_change', outcome: 'success', userId: req.user.id, ip: req.ip });
  // The client swaps these in so the current device stays signed in.
  res.json({ ok: true, ...tokens });
}
