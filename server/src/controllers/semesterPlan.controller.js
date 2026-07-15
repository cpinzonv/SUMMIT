import { z } from 'zod';
import * as svc from '../services/semesterPlan.service.js';
import { AppError } from '../utils/AppError.js';

/* Extraction: multipart (optional image) + a `text` field. No zod (multipart). */
export async function extract(req, res) {
  const text = req.body?.text;
  if (!req.file && !(text && String(text).trim())) {
    throw AppError.badRequest('Paste your course listing or upload a screenshot.');
  }
  const sections = await svc.extractSections({ text, file: req.file });
  res.json({ sections });
}

export async function getPlan(req, res) {
  res.json(await svc.getPlan(req.user.id, req.query.term ? String(req.query.term) : null));
}

const sectionInput = z.object({
  courseCode: z.string().max(300).nullable().optional(),
  courseTitle: z.string().max(300).nullable().optional(),
  sectionNumber: z.string().max(300).nullable().optional(),
  days: z.array(z.string()).max(7).optional(),
  startTime: z.string().max(20).nullable().optional(),
  endTime: z.string().max(20).nullable().optional(),
  professor: z.string().max(300).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  term: z.string().max(100).nullable().optional(),
});

export const paramPlan = z.object({ planId: z.string().uuid('Invalid plan id') });
export const paramSection = z.object({ sectionId: z.string().uuid('Invalid section id') });

export const appendSchema = z.object({ sections: z.array(sectionInput).min(1, 'No sections to save').max(200) });
export async function appendSections(req, res) {
  res.json({ sections: await svc.appendSections(req.user.id, req.params.planId, req.body.sections) });
}

export const updateSchema = sectionInput.refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });
export async function updateSection(req, res) {
  res.json({ section: await svc.updateSection(req.user.id, req.params.sectionId, req.body) });
}

export async function deleteSection(req, res) {
  await svc.deleteSection(req.user.id, req.params.sectionId);
  res.status(204).end();
}

export const termSchema = z.object({ term: z.string().max(100).nullable() });
export async function setTerm(req, res) {
  res.json(await svc.setPlanTerm(req.user.id, req.params.planId, req.body.term));
}
