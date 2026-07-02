import { z } from 'zod';
import * as lmsService from '../services/lms.service.js';
import { getOwnedClass } from '../services/class.service.js';
import { DEFAULT_PROVIDER } from '../services/lms/index.js';

/**
 * The provider is taken from the route mount (req.lmsProvider, e.g. the
 * "/blackboard" in POST /api/blackboard/sync), so it is trusted and never comes
 * from the request body. Handlers that don't run under a provider mount fall
 * back to the default (Canvas) for backward compatibility.
 */
function providerOf(req) {
  return req.lmsProvider || DEFAULT_PROVIDER;
}

// domain is required for multi-tenant providers; single-tenant ones (Google
// Classroom) omit it. The provider module enforces its own requirement, so here
// we only need it to be a non-empty string when present.
export const authUrlQuery = z.object({
  domain: z.string().min(1).optional(),
});

export const callbackSchema = z.object({
  // Accepted for backward-compat but ignored — provider comes from the mount.
  provider: z.string().optional(),
  domain: z.string().min(1).optional(),
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
  redirectUri: z.string().optional(),
});

// Personal-access-token connect (Canvas): the student pastes their instance URL
// + a token. domain is required for multi-tenant providers (the service also
// enforces this per provider).
export const connectTokenSchema = z.object({
  domain: z.string().trim().min(1).optional(),
  token: z.string().trim().min(1, 'Paste your access token'),
});

export const classIdParam = z.object({ classId: z.string().uuid('Invalid class id') });

export const importSchema = z.object({
  externalIds: z.array(z.string().min(1)).min(1, 'Select at least one assignment'),
});

/** Status for ALL providers (used by Settings to render every connection card). */
export async function statusAll(req, res) {
  res.json({ providers: await lmsService.getStatuses(req.user.id) });
}

/** Status for the mounted provider. */
export async function status(req, res) {
  res.json(await lmsService.getStatus(req.user.id, providerOf(req)));
}

export async function authUrl(req, res) {
  res.json(lmsService.buildAuthUrl(req.user.id, providerOf(req), req.query));
}

export async function callback(req, res) {
  res.json(await lmsService.connect(req.user.id, providerOf(req), req.body));
}

/** Connect using a pasted personal API token (no OAuth redirect). */
export async function connectToken(req, res) {
  res.json(await lmsService.connectWithToken(req.user.id, providerOf(req), req.body));
}

export async function disconnect(req, res) {
  res.json(await lmsService.disconnect(req.user.id, providerOf(req)));
}

export async function sync(req, res) {
  res.json(await lmsService.syncAll(req.user.id, providerOf(req), { trigger: 'manual' }));
}

/** Recent sync attempts for the mounted provider (audit trail / debugging). */
export async function syncLog(req, res) {
  res.json({ log: await lmsService.getSyncLog(req.user.id, providerOf(req)) });
}

export async function listCourseAssignments(req, res) {
  const cls = await getOwnedClass(req.user.id, req.params.classId);
  res.json({ assignments: await lmsService.listImportableAssignments(req.user.id, providerOf(req), cls) });
}

export async function importCourseAssignments(req, res) {
  const cls = await getOwnedClass(req.user.id, req.params.classId);
  const result = await lmsService.importAssignments(req.user.id, providerOf(req), cls, req.body.externalIds);
  res.json(result);
}
