import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { enforceUsage } from '../middleware/enforceUsage.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as pb from '../controllers/semesterPlan.controller.js';

const router = Router();
router.use(requireAuth);

// Screenshots only for the builder (paste covers everything else). JPG/PNG.
const IMAGE_MIME = new Set(['image/jpeg', 'image/png']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    IMAGE_MIME.has(file.mimetype) ? cb(null, true) : cb(AppError.badRequest('Upload a JPG or PNG screenshot, or paste the text.')),
});

// Extract sections from pasted text or a screenshot (Claude, server-side).
// Metered like syllabus extraction — one 'extraction' event per submission.
router.post('/extract', enforceUsage('extraction'), upload.single('image'), asyncHandler(pb.extract));

// The user's draft plan + its saved sections (created lazily).
router.get('/plan', asyncHandler(pb.getPlan));

// Save (append) reviewed sections; set the draft's term label.
router.post('/plan/:planId/sections', validate(pb.paramPlan, 'params'), validate(pb.appendSchema), asyncHandler(pb.appendSections));
router.patch('/plan/:planId/term', validate(pb.paramPlan, 'params'), validate(pb.termSchema), asyncHandler(pb.setTerm));

// Stage B: mark a course Required/Optional, and commit a chosen schedule into
// the Planner's 4-year roadmap for the plan's term.
router.patch('/plan/:planId/course-pref', validate(pb.paramPlan, 'params'), validate(pb.courseReqSchema), asyncHandler(pb.setCourseRequirement));
router.post('/plan/:planId/commit', validate(pb.paramPlan, 'params'), validate(pb.commitSchema), asyncHandler(pb.commitSchedule));

// Edit / remove a single saved section (owner-scoped).
router.patch('/sections/:sectionId', validate(pb.paramSection, 'params'), validate(pb.updateSchema), asyncHandler(pb.updateSection));
router.delete('/sections/:sectionId', validate(pb.paramSection, 'params'), asyncHandler(pb.deleteSection));

export default router;
