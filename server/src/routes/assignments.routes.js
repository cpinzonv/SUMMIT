import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as assignments from '../controllers/assignments.controller.js';

// Update/delete a single assignment by id (creation + listing are nested under
// /api/classes/:id/assignments). Ownership is enforced via the parent class.
const router = Router();

// Submission attachments: kept in memory, 32MB cap (matches class file uploads).
const submissionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });

router.use(requireAuth);

router.patch(
  '/:assignmentId',
  validate(assignments.assignmentIdParam, 'params'),
  validate(assignments.updateAssignmentSchema),
  asyncHandler(assignments.update),
);

router.delete(
  '/:assignmentId',
  validate(assignments.assignmentIdParam, 'params'),
  asyncHandler(assignments.remove),
);

// Submit / update a submission (optional text + optional file), and withdraw it.
router.post(
  '/:assignmentId/submission',
  validate(assignments.assignmentIdParam, 'params'),
  submissionUpload.single('file'),
  validate(assignments.submissionSchema),
  asyncHandler(assignments.submit),
);
router.delete(
  '/:assignmentId/submission',
  validate(assignments.assignmentIdParam, 'params'),
  asyncHandler(assignments.unsubmit),
);

export default router;
