import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as lms from '../controllers/lms.controller.js';

/**
 * Provider-scoped LMS router. routes/index.js mounts one copy of this per
 * provider (e.g. at /api/canvas, /api/blackboard, ...) behind a tiny middleware
 * that stamps req.lmsProvider, so every handler knows which LMS it's acting on
 * without the provider ever coming from the request body.
 *
 * Endpoints (relative to the provider mount, e.g. /api/blackboard):
 *   GET  /status                          connection status
 *   GET  /auth-url?domain=...             begin OAuth (returns authorize URL)
 *   POST /connect                         exchange code → store tokens
 *   POST /disconnect                      forget tokens
 *   GET|POST /sync                        full sync of all courses
 *   GET  /courses/:classId/assignments    list a class's importable assignments
 *   POST /courses/:classId/import         import a selected subset
 */
const router = Router({ mergeParams: true });

// All LMS routes require an authenticated Summit user (the OAuth link is
// attached to their account).
router.use(requireAuth);

router.get('/status', asyncHandler(lms.status));
router.get('/auth-url', validate(lms.authUrlQuery, 'query'), asyncHandler(lms.authUrl));

// Exchange the OAuth code the provider sent back for tokens.
router.post('/connect', validate(lms.callbackSchema), asyncHandler(lms.callback));
router.post('/disconnect', asyncHandler(lms.disconnect));

// Full sync of all courses. POST is canonical (it mutates); GET is accepted too
// for convenience / the spec's "GET /api/<provider>/sync".
router.post('/sync', asyncHandler(lms.sync));
router.get('/sync', asyncHandler(lms.sync));

// Per-class import: list a course's assignments, then import a selected subset.
router.get(
  '/courses/:classId/assignments',
  validate(lms.classIdParam, 'params'),
  asyncHandler(lms.listCourseAssignments),
);
router.post(
  '/courses/:classId/import',
  validate(lms.classIdParam, 'params'),
  validate(lms.importSchema),
  asyncHandler(lms.importCourseAssignments),
);

export default router;
