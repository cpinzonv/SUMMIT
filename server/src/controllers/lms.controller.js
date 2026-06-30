import { z } from 'zod';
import * as lmsService from '../services/lms.service.js';
import { getOwnedClass } from '../services/class.service.js';

const provider = z.enum(['canvas']).default('canvas');

export const authUrlQuery = z.object({
  provider,
  domain: z.string().min(1, 'Canvas domain is required'),
});

export const callbackSchema = z.object({
  provider,
  domain: z.string().min(1, 'Canvas domain is required'),
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
  redirectUri: z.string().optional(),
});

export const classIdParam = z.object({ classId: z.string().uuid('Invalid class id') });

export const importSchema = z.object({
  externalIds: z.array(z.string().min(1)).min(1, 'Select at least one assignment'),
});

export async function status(req, res) {
  res.json(await lmsService.getStatus(req.user.id));
}

export async function authUrl(req, res) {
  res.json(lmsService.buildAuthUrl(req.user.id, req.query));
}

export async function callback(req, res) {
  res.json(await lmsService.connect(req.user.id, req.body));
}

export async function disconnect(req, res) {
  res.json(await lmsService.disconnect(req.user.id));
}

export async function sync(req, res) {
  const result = await lmsService.syncAll(req.user.id);
  res.json(result);
}

export async function listCourseAssignments(req, res) {
  const cls = await getOwnedClass(req.user.id, req.params.classId);
  res.json({ assignments: await lmsService.listImportableAssignments(req.user.id, cls) });
}

export async function importCourseAssignments(req, res) {
  const cls = await getOwnedClass(req.user.id, req.params.classId);
  const result = await lmsService.importAssignments(req.user.id, cls, req.body.externalIds);
  res.json(result);
}
