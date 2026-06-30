import { z } from 'zod';
import * as planService from '../services/plan.service.js';

const season = z.enum(['Spring', 'Summer', 'Fall', 'Winter']);
const status = z.enum(['planned', 'in_progress', 'completed']);

export const createSchema = z.object({
  year: z.number().int().min(1900).max(2200),
  season,
  name: z.string().min(1, 'name is required'),
  code: z.string().optional(),
  credits: z.number().nonnegative().optional(),
  status: status.optional(),
});

export const updateSchema = z
  .object({
    year: z.number().int().min(1900).max(2200).optional(),
    season: season.optional(),
    name: z.string().min(1).optional(),
    code: z.string().nullable().optional(),
    credits: z.number().nonnegative().nullable().optional(),
    status: status.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const itemIdParam = z.object({ itemId: z.string().uuid('Invalid plan item id') });

export async function get(req, res) {
  const plan = await planService.getPlan(req.user.id);
  res.json(plan);
}

/** Auto-create Dashboard classes for planner courses whose term has started. */
export async function syncActive(req, res) {
  const result = await planService.syncActiveCourses(req.user.id);
  res.json(result);
}

export async function create(req, res) {
  const item = await planService.createPlanItem(req.user.id, req.body);
  res.status(201).json({ item });
}

export async function update(req, res) {
  const item = await planService.updatePlanItem(req.user.id, req.params.itemId, req.body);
  res.json({ item });
}

export async function remove(req, res) {
  await planService.deletePlanItem(req.user.id, req.params.itemId);
  res.status(204).end();
}
