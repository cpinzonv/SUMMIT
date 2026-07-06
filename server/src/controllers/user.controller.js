import { z } from 'zod';
import * as userService from '../services/user.service.js';
import * as twofa from '../services/twofa.service.js';

export const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    colorScheme: z.enum(['default']).optional(), // others are "coming soon"
    fontSize: z.enum(['small', 'normal', 'large']).optional(),
    compactMode: z.boolean().optional(),
    defaultDashboardView: z.enum(['cards', 'list']).optional(),
    defaultCalendarView: z.enum(['month', 'week', 'day']).optional(),
    notificationsEnabled: z.boolean().optional(),
    showArchived: z.boolean().optional(),
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
