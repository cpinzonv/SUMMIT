import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as files from '../controllers/files.controller.js';

const router = Router();
router.use(requireAuth);

// Download/preview the raw bytes, then delete — both by file id. (List + upload
// live under /api/classes/:id/files.)
router.get('/:fileId/download', validate(files.fileIdParam, 'params'), asyncHandler(files.download));
router.delete('/:fileId', validate(files.fileIdParam, 'params'), asyncHandler(files.remove));

export default router;
