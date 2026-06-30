import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as lms from '../controllers/lms.controller.js';

const router = Router();

// All Canvas/LMS routes require an authenticated Summit user (the OAuth link is
// attached to their account).
router.use(requireAuth);

router.get('/status', asyncHandler(lms.status));
router.get('/auth-url', validate(lms.authUrlQuery, 'query'), asyncHandler(lms.authUrl));
router.post('/disconnect', asyncHandler(lms.disconnect));

// Full sync of all courses. POST is canonical (it mutates); GET is accepted too
// for convenience / the spec's "GET /api/canvas/sync".
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
