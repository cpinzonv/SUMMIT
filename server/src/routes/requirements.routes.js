import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { enforceUsage } from '../middleware/enforceUsage.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as rq from '../controllers/requirements.controller.js';

const router = Router();
router.use(requireAuth);

// A requirements sheet: a photo, a PDF, or pasted text. JPG/PNG/PDF.
const FILE_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    FILE_MIME.has(file.mimetype) ? cb(null, true) : cb(AppError.badRequest('Upload a photo (JPG/PNG) or a PDF, or paste the text.')),
});

// Extract the requirement structure from pasted text or an uploaded sheet
// (Claude, server-side). Metered like every other extraction — one 'extraction'
// event per submission.
router.post('/extract', enforceUsage('extraction'), upload.single('file'), asyncHandler(rq.extract));

// The user's degree program + categories + courses (owner-scoped).
router.get('/', asyncHandler(rq.get));
// Save the reviewed requirements (full replace of the program's categories).
router.put('/', validate(rq.saveSchema), asyncHandler(rq.save));
// Remove the program entirely.
router.delete('/', asyncHandler(rq.remove));

export default router;
