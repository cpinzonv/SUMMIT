import { z } from 'zod';
import * as userService from '../services/user.service.js';
import * as twofa from '../services/twofa.service.js';
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
  res.json(await twofa.confirm(req.user.id, req.body.code));
}
export async function twofaDisable(req, res) {
  await twofa.disable(req.user.id, req.body.password);
  res.json({ ok: true });
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
