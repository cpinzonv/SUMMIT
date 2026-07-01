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
    // Academic planning: program length (years) + credits per year drive the
    // Planner's roadmap headline and graduation-credit goal.
    academicDuration: z.number().int().min(1).max(12).optional(),
    creditsPerYear: z.number().int().min(1).max(60).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'No preferences provided' });

export async function updatePreferences(req, res) {
  const preferences = await userService.updatePreferences(req.user.id, req.body);
  res.json({ preferences });
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
