import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as attendance from '../controllers/attendance.controller.js';

// Delete an attendance record by id. List/mark are nested under
// /api/classes/:id/attendance.
const router = Router();

router.use(requireAuth);

router.delete(
  '/:attendanceId',
  validate(attendance.attendanceIdParam, 'params'),
  asyncHandler(attendance.remove),
);

export default router;
