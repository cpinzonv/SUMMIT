import { z } from 'zod';
import * as userService from '../services/user.service.js';

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
