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
  pinned: z.boolean().optional(), // Stage B: lock a section for the solver
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

/* ------------------------------------------------- Stage B: requirements + commit */

export const courseReqSchema = z.object({
  courseCode: z.string().min(1).max(300),
  required: z.boolean(),
});
export async function setCourseRequirement(req, res) {
  const { courseCode, required } = req.body;
  res.json({ requirements: await svc.setCourseRequirement(req.user.id, req.params.planId, courseCode, required) });
}

export const commitSchema = z.object({ sectionIds: z.array(z.string().uuid()).min(1, 'Pick a schedule first').max(50) });
export async function commitSchedule(req, res) {
  res.json(await svc.commitSchedule(req.user.id, req.params.planId, req.body.sectionIds));
}

/* --------------------------------------------- Stage C: preferences + advisor */

const prefsSchema = z
  .object({
    earliestStart: z.string().max(10).nullable().optional(),
    latestEnd: z.string().max(10).nullable().optional(),
    daysFree: z.array(z.string().max(3)).max(7).optional(),
    gapStyle: z.enum(['minimize', 'spread']).nullable().optional(),
    fewerDays: z.boolean().optional(),
    professors: z.record(z.enum(['prefer', 'avoid'])).optional(),
  })
  .nullable();

export const preferencesSchema = z.object({ preferences: prefsSchema });
export async function setPreferences(req, res) {
  res.json({ preferences: await svc.setPreferences(req.user.id, req.params.planId, req.body.preferences) });
}

const adviseCandidate = z.object({
  id: z.string().min(1).max(20),
  label: z.string().max(80).optional(),
  sectionIds: z.array(z.string().uuid()).min(1).max(20),
  daysOnCampus: z.number().int().min(0).max(7).optional(),
  earliest: z.string().max(10).nullable().optional(),
  latest: z.string().max(10).nullable().optional(),
  gapHours: z.number().min(0).max(200).optional(),
  professors: z.array(z.string().max(120)).max(30).optional(),
  perDay: z.record(z.string().max(400)).optional(),
  compromises: z.array(z.string().max(120)).max(30).optional(),
});
export const adviseSchema = z.object({
  candidates: z.array(adviseCandidate).min(1).max(3),
  preferences: prefsSchema.optional(),
});

// Cache-check middleware: a hit returns the cached advice and ENDS the request,
// so it never reaches enforceUsage — re-opening the advisor doesn't re-bill.
export async function adviseCacheCheck(req, res, next) {
  const hash = svc.hashAdvice(req.body.candidates, req.body.preferences || {});
  req.adviceHash = hash;
  const cached = await svc.getCachedAdvice(req.user.id, req.params.planId, hash);
  if (cached) { res.json({ ...cached, cached: true }); return; }
  next();
}
export async function advise(req, res) {
  const result = await svc.adviseSchedules(req.user.id, req.params.planId, req.body, req.adviceHash);
  res.json({ ...result, cached: false });
}
