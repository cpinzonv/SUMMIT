import { Router } from 'express';
import authRoutes from './auth.routes.js';
import oauthRoutes from './oauth.routes.js';
import classesRoutes from './classes.routes.js';
import assignmentsRoutes from './assignments.routes.js';
import gradesRoutes from './grades.routes.js';
import archivesRoutes from './archives.routes.js';
import notesRoutes from './notes.routes.js';
import attendanceRoutes from './attendance.routes.js';
import planRoutes from './plan.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';
import workloadRoutes from './workload.routes.js';
import gcalRoutes from './gcal.routes.js';
import filesRoutes from './files.routes.js';
import transcriptsRoutes from './transcripts.routes.js';
import lmsRoutes from './lms.routes.js';
import learnRoutes from './learn.routes.js';
import { flashcardsRouter, decksRouter, studyRouter } from './deckStudy.routes.js';
import featuresRoutes from './features.routes.js';
import institutionAdminRoutes from './institutionAdmin.routes.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as lmsController from '../controllers/lms.controller.js';
import { PROVIDER_KEYS } from '../services/lms/index.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/auth', oauthRoutes); // OAuth social login (Google/Apple/GitHub)
router.use('/user', userRoutes);
router.use('/admin', adminRoutes);

// LMS integrations. The same provider-scoped router is mounted once per provider
// (Canvas, Blackboard, Google Classroom, Brightspace, Moodle, Sakai). A small
// middleware stamps req.lmsProvider from the mount path so handlers stay
// provider-agnostic — e.g. POST /api/blackboard/sync vs. POST /api/moodle/sync.
router.get('/lms/status', requireAuth, asyncHandler(lmsController.statusAll));
for (const key of PROVIDER_KEYS) {
  router.use(
    `/${key}`,
    (req, _res, next) => {
      req.lmsProvider = key;
      next();
    },
    lmsRoutes,
  );
}

router.use('/classes', classesRoutes); // assignments/notes/attendance nested here
router.use('/assignments', assignmentsRoutes); // update/delete by id
router.use('/grades', gradesRoutes);
router.use('/archives', archivesRoutes);
router.use('/notes', notesRoutes); // update/delete by id + cross-class search
router.use('/attendance', attendanceRoutes); // delete by id
router.use('/plan', planRoutes);
router.use('/workload', workloadRoutes); // weekly estimated-hours prediction
router.use('/google-calendar', gcalRoutes); // Summit → Google Calendar one-way sync
router.use('/files', filesRoutes); // per-class file download/delete by id
router.use('/transcripts', transcriptsRoutes); // transcript update/delete by id
router.use('/learn', learnRoutes); // Learn tab — flashcards + spaced repetition
router.use('/flashcards', flashcardsRouter); // classic SM-2: rate a card 1–5
router.use('/decks', decksRouter); // deck settings, deadlines, study plan
router.use('/study', studyRouter); // today's study queue (respects limits)
router.use('/features', featuresRoutes); // feature gating status (lock icons + paywall)
router.use('/institution', institutionAdminRoutes); // institution-admin: roster + overview (tenant-scoped)

export default router;
