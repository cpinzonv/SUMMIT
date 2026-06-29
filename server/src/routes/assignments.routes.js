import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as assignments from '../controllers/assignments.controller.js';

// Update/delete a single assignment by id (creation + listing are nested under
// /api/classes/:id/assignments). Ownership is enforced via the parent class.
const router = Router();

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

export default router;
