import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { enforceUsage } from '../middleware/enforceUsage.js';
import { aiLimiter } from '../middleware/rateLimit.js';
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

// Auto-transcribe the linked audio (Whisper), summarize (Claude), turn the
// summary into a class note, or drop just the audio recording.
router.post(
  '/:transcriptId/transcribe',
  validate(transcripts.transcriptIdParam, 'params'),
  aiLimiter, // paid Whisper call — per-account burst + monthly quota
  enforceUsage('ai_requests'),
  asyncHandler(transcripts.transcribe),
);
router.post(
  '/:transcriptId/summary',
  validate(transcripts.transcriptIdParam, 'params'),
  aiLimiter, // paid Claude call
  enforceUsage('ai_requests'),
  asyncHandler(transcripts.summary),
);
router.post(
  '/:transcriptId/move-to-notes',
  validate(transcripts.transcriptIdParam, 'params'),
  asyncHandler(transcripts.moveToNotes),
);
router.delete(
  '/:transcriptId/audio',
  validate(transcripts.transcriptIdParam, 'params'),
  asyncHandler(transcripts.removeAudio),
);

export default router;
