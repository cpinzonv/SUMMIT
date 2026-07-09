import { z } from 'zod';
import * as userService from '../services/user.service.js';
import * as twofa from '../services/twofa.service.js';
import { logSecurityEvent } from '../services/audit.service.js';
import * as trustedDevices from '../services/trustedDevice.service.js';
import * as account from '../services/account.service.js';

export const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    colorScheme: z.enum(['default', 'ocean', 'forest', 'sunset']).optional(),
    fontSize: z.enum(['small', 'normal', 'large']).optional(),
    compactMode: z.boolean().optional(),
    defaultDashboardView: z.enum(['cards', 'list']).optional(),
    defaultCalendarView: z.enum(['month', 'week', 'day']).optional(),
    notificationsEnabled: z.boolean().optional(),
    showArchived: z.boolean().optional(),
    // Kanban: show the optional Backlog + Planning columns (default off) on both
    // the To-Do board and the per-class boards.
    boardExtraColumns: z.boolean().optional(),
    // Hide the Planner tab from the primary nav.
    hidePlanner: z.boolean().optional(),
    // Podcast host voices (ElevenLabs voice ids); '' clears back to the default.
    podcastVoiceA: z.string().max(64).optional(),
    podcastVoiceB: z.string().max(64).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'No preferences provided' });

export async function updatePreferences(req, res) {
  const preferences = await userService.updatePreferences(req.user.id, req.body);
  res.json({ preferences });
}

/* ---- Graduation requirements ------------------------------------------- */
export const graduationSettingsSchema = z.object({
  graduationCredits: z
    .number({ invalid_type_error: 'Must be a positive number' })
    .int('Must be a whole number')
    .positive('Must be a positive number')
    .max(1000, 'That looks too high'),
  semesterCredits: z
    .number({ invalid_type_error: 'Must be a positive number' })
    .int('Must be a whole number')
    .positive('Must be a positive number')
    .max(100, 'That looks too high')
    .nullable()
    .optional(),
});

export async function getGraduationSettings(req, res) {
  res.json(await userService.getGraduationSettings(req.user.id));
}

export async function updateGraduationSettings(req, res) {
  res.json(await userService.updateGraduationSettings(req.user.id, req.body));
}

/* ---- Two-factor authentication ----------------------------------------- */
export const twofaConfirmSchema = z.object({ code: z.string().min(1, 'Enter the 6-digit code') });
export const twofaDisableSchema = z.object({ password: z.string().min(1, 'Password is required') });

export async function twofaSetup(req, res) {
  res.json(await twofa.setup(req.user.id));
}
export async function twofaConfirm(req, res) {
  const result = await twofa.confirm(req.user.id, req.body.code);
  await logSecurityEvent({ action: '2fa_enable', outcome: 'success', userId: req.user.id, ip: req.ip });
  res.json(result);
}
export async function twofaDisable(req, res) {
  try {
    await twofa.disable(req.user.id, req.body.password);
  } catch (err) {
    await logSecurityEvent({ action: '2fa_disable', outcome: 'failure', userId: req.user.id, ip: req.ip });
    throw err;
  }
  // Turning off 2FA makes device trust meaningless — clear all trusted devices.
  await trustedDevices.revokeAllTrustedDevices(req.user.id);
  await logSecurityEvent({ action: '2fa_disable', outcome: 'success', userId: req.user.id, ip: req.ip });
  res.json({ ok: true });
}

/* ---- Trusted devices (remember-this-device for 2FA) -------------------- */
export const deviceIdParam = z.object({ deviceId: z.string().uuid('Invalid device id') });

export async function listDevices(req, res) {
  res.json({ devices: await trustedDevices.listTrustedDevices(req.user.id) });
}
export async function revokeDevice(req, res) {
  await trustedDevices.revokeTrustedDevice(req.user.id, req.params.deviceId);
  await logSecurityEvent({ action: 'trusted_device_revoke', outcome: 'success', userId: req.user.id, ip: req.ip });
  res.status(204).end();
}
export async function revokeAllDevices(req, res) {
  await trustedDevices.revokeAllTrustedDevices(req.user.id);
  await logSecurityEvent({ action: 'trusted_device_revoke_all', outcome: 'success', userId: req.user.id, ip: req.ip });
  res.status(204).end();
}

/* ---- Account security & recovery (phone, backup email, change email) --- */
const codeSchema = z.object({ code: z.string().min(1, 'Enter the code we sent you') });

export const phoneSchema = z.object({ phone: z.string().min(1, 'Enter a phone number') });
export const phoneVerifySchema = codeSchema;
export async function addPhone(req, res) {
  res.json(await account.addPhone(req.user.id, req.body.phone));
}
export async function verifyPhone(req, res) {
  res.json(await account.verifyPhone(req.user.id, req.body.code));
}
export async function removePhone(req, res) {
  res.json(await account.removePhone(req.user.id));
}

export const recoveryEmailSchema = z.object({ email: z.string().email('Enter a valid email').toLowerCase() });
export const recoveryEmailVerifySchema = codeSchema;
export async function addRecoveryEmail(req, res) {
  res.json(await account.addRecoveryEmail(req.user.id, req.body.email));
}
export async function verifyRecoveryEmail(req, res) {
  res.json(await account.verifyRecoveryEmail(req.user.id, req.body.code));
}
export async function removeRecoveryEmail(req, res) {
  res.json(await account.removeRecoveryEmail(req.user.id));
}

export const emailChangeSchema = z.object({ email: z.string().email('Enter a valid email').toLowerCase() });
export const emailChangeVerifySchema = codeSchema;
export async function requestEmailChange(req, res) {
  res.json(await account.requestEmailChange(req.user.id, req.body.email));
}
export async function verifyEmailChange(req, res) {
  res.json(await account.verifyEmailChange(req.user.id, req.body.code));
}
