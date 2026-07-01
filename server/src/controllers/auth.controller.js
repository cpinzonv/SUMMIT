import { z } from 'zod';
import * as authService from '../services/auth.service.js';
import * as passwordResetService from '../services/passwordReset.service.js';

// Allowed "How'd you hear about us?" values (kept in sync with the client form).
export const REFERRAL_SOURCES = [
  'friend',
  'google_search',
  'social_media',
  'school',
  'app_store',
  'other',
];

export const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required'),
  school: z.string().optional(),
  timezone: z.string().optional(),
  referralSource: z.enum(REFERRAL_SOURCES).optional(),
  referralSourceDetail: z.string().max(200).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const login2faSchema = z.object({
  challengeToken: z.string().min(1, 'challengeToken is required'),
  code: z.string().min(1, 'Enter your authentication code'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
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

export async function login(req, res) {
  const result = await authService.login(req.body);
  res.json(result);
}

export async function loginTwoFactor(req, res) {
  const result = await authService.loginTwoFactor(req.body);
  res.json(result);
}

export async function refresh(req, res) {
  const result = await authService.refresh(req.body);
  res.json(result);
}

export async function logout(req, res) {
  await authService.logout(req.body);
  res.status(204).end();
}

export async function me(req, res) {
  const user = await authService.getCurrentUser(req.user.id);
  res.json({ user });
}

export async function changePassword(req, res) {
  await authService.changePassword(
    req.user.id,
    req.body.currentPassword,
    req.body.newPassword,
  );
  res.json({ ok: true });
}

/**
 * Start a password reset. Responds identically whether or not the email is
 * registered, so it never reveals which addresses have accounts.
 */
export async function forgotPassword(req, res) {
  await passwordResetService.requestPasswordReset(req.body.email);
  res.json({
    message: 'If an account exists for that email, a reset link is on its way.',
  });
}

/** Complete a password reset using the token from the emailed link. */
export async function resetPassword(req, res) {
  await passwordResetService.resetPassword(req.body.token, req.body.newPassword);
  res.json({ message: 'Password reset successfully. You can now log in.' });
}
