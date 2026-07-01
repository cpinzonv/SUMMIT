import { z } from 'zod';
import * as userService from '../services/user.service.js';
import * as twofa from '../services/twofa.service.js';
import * as classService from '../services/class.service.js';
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

export const userIdParam = z.object({ userId: z.string().uuid('Invalid user id') });

// GET /api/users/:userId/canvas/grades — synced Canvas grades. A user may read
// their own; admins may read anyone's.
export async function canvasGrades(req, res) {
  const targetId = req.params.userId;
  if (targetId !== req.user.id) {
    const { rows } = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (rows[0]?.role !== 'admin') throw AppError.forbidden('You can only view your own Canvas grades.');
  }
  const grades = await classService.listCanvasGradesForUser(targetId);
  res.json({ grades, count: grades.length });
}

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
