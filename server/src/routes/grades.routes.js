import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as grades from '../controllers/grades.controller.js';

const router = Router();

router.use(requireAuth);

// Submit/update a grade for an assignment; response includes the recomputed
// current class grade.
router.post('/', validate(grades.submitGradeSchema), asyncHandler(grades.submit));

export default router;
