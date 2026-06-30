import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as transcripts from '../controllers/transcripts.controller.js';

// Update/delete a transcript by id. (List/create/record live under
// /api/classes/:id/transcripts.)
const router = Router();
router.use(requireAuth);

router.patch(
  '/:transcriptId',
  validate(transcripts.transcriptIdParam, 'params'),
  validate(transcripts.updateSchema),
  asyncHandler(transcripts.update),
);
router.delete(
  '/:transcriptId',
  validate(transcripts.transcriptIdParam, 'params'),
  asyncHandler(transcripts.remove),
);

export default router;
