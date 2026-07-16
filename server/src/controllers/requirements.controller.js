import { z } from 'zod';
import * as svc from '../services/requirements.service.js';
import { AppError } from '../utils/AppError.js';

/* Extraction: multipart (optional photo/PDF) + a `text` field. No zod (multipart). */
export async function extract(req, res) {
  const text = req.body?.text;
  if (!req.file && !(text && String(text).trim())) {
    throw AppError.badRequest('Paste your requirements or upload a photo/PDF.');
  }
  res.json(await svc.extractRequirements({ text, file: req.file }));
}

export async function get(req, res) {
  res.json(await svc.getRequirements(req.user.id));
}

// credits/creditsRequired/totalCredits arrive as numbers or strings — the
// service coerces them; here we just bound the shape.
const intish = z.union([z.number(), z.string()]).nullable().optional();
const courseInput = z.object({
  courseCode: z.string().max(500).nullable().optional(),
  courseTitle: z.string().max(500).nullable().optional(),
  credits: intish,
  offeredTerms: z.array(z.enum(['Fall', 'Spring', 'Summer'])).nullable().optional(),
  prereqGroups: z.array(z.array(z.string().max(120))).max(20).optional(),
});
const categoryInput = z.object({
  name: z.string().max(500).nullable().optional(),
  creditsRequired: intish,
  notes: z.string().max(2000).nullable().optional(),
  courses: z.array(courseInput).max(300).optional(),
});
export const saveSchema = z.object({
  program: z
    .object({ name: z.string().max(500).nullable().optional(), totalCredits: intish })
    .optional(),
  categories: z.array(categoryInput).max(100),
});
export async function save(req, res) {
  res.json(await svc.saveRequirements(req.user.id, req.body));
}

export async function remove(req, res) {
  await svc.deleteRequirements(req.user.id);
  res.status(204).end();
}

/* ------------------------------------------------- Stage R2: completed + met */

export const completedSchema = z.object({
  courseCode: z.string().min(1).max(500),
  courseTitle: z.string().max(500).nullable().optional(),
  credits: intish,
  source: z.enum(['completed', 'transferred', 'ap']).optional(),
});
export async function addCompleted(req, res) {
  res.json({ completed: await svc.addCompleted(req.user.id, req.body) });
}
export async function removeCompleted(req, res) {
  res.json({ completed: await svc.removeCompleted(req.user.id, req.params.id) });
}

export const metSchema = z.object({ token: z.string().min(1).max(200) });
export async function addMet(req, res) {
  res.json({ metTokens: await svc.addMet(req.user.id, req.body.token) });
}
export async function removeMet(req, res) {
  res.json({ metTokens: await svc.removeMet(req.user.id, req.params.id) });
}

export const idParam = z.object({ id: z.string().uuid('Invalid id') });
