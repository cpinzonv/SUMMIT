import { z } from 'zod';
import * as authService from '../services/auth.service.js';

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
  res.json(await authService.resetPassword(req.body));
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
