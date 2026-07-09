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

router.get(
  '/:assignmentId',
  validate(assignments.assignmentIdParam, 'params'),
  asyncHandler(assignments.getOne),
);

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

// ---- Detail modal ---------------------------------------------------------

// AI time estimate from the (optionally just-pasted) instructions.
router.post(
  '/:assignmentId/estimate-time',
  validate(assignments.assignmentIdParam, 'params'),
  validate(assignments.estimateSchema),
  asyncHandler(assignments.estimateTime),
);

// Instruction files: list / upload / rename / delete.
router.get(
  '/:assignmentId/files',
  validate(assignments.assignmentIdParam, 'params'),
  asyncHandler(assignments.listFiles),
);
router.post(
  '/:assignmentId/files',
  validate(assignments.assignmentIdParam, 'params'),
  submissionUpload.single('file'),
  asyncHandler(assignments.addFile),
);
router.patch(
  '/:assignmentId/files/:fileId',
  validate(assignments.fileIdParam, 'params'),
  validate(assignments.renameFileSchema),
  asyncHandler(assignments.renameFile),
);
router.delete(
  '/:assignmentId/files/:fileId',
  validate(assignments.fileIdParam, 'params'),
  asyncHandler(assignments.removeFile),
);

// Submission history: list / add (file|link|working) / delete.
router.get(
  '/:assignmentId/submissions',
  validate(assignments.assignmentIdParam, 'params'),
  asyncHandler(assignments.listSubmissions),
);
router.post(
  '/:assignmentId/submissions',
  validate(assignments.assignmentIdParam, 'params'),
  submissionUpload.single('file'),
  validate(assignments.newSubmissionSchema),
  asyncHandler(assignments.addSubmission),
);
router.delete(
  '/:assignmentId/submissions/:submissionId',
  validate(assignments.submissionIdParam, 'params'),
  asyncHandler(assignments.removeSubmission),
);

export default router;
