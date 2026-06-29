import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as classes from '../controllers/classes.controller.js';
import * as assignments from '../controllers/assignments.controller.js';

const router = Router();

// Every class route requires authentication; handlers scope to req.user.id.
router.use(requireAuth);

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
