import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as classes from '../controllers/classes.controller.js';
import * as assignments from '../controllers/assignments.controller.js';
import * as syllabus from '../controllers/syllabus.controller.js';

// Keep the uploaded PDF in memory; cap at 32MB (the Claude API request limit).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
});

const router = Router();

// Every class route requires authentication; handlers scope to req.user.id.
router.use(requireAuth);

// Extract structured data from a syllabus PDF (Claude). Defined before the
// "/:id" routes so the literal path matches first.
router.post(
  '/extract-syllabus',
  upload.single('file'),
  asyncHandler(syllabus.extractSyllabus),
);

router.post('/', validate(classes.createClassSchema), asyncHandler(classes.create));
router.get('/', asyncHandler(classes.list));

router.put(
  '/:id/archive',
  validate(classes.classIdParam, 'params'),
  asyncHandler(classes.archive),
);

// Assignments nested under a class.
router.post(
  '/:id/assignments',
  validate(classes.classIdParam, 'params'),
  validate(assignments.createAssignmentSchema),
  asyncHandler(assignments.create),
);
router.get(
  '/:id/assignments',
  validate(classes.classIdParam, 'params'),
  asyncHandler(assignments.list),
);

export default router;
