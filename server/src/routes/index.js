import { Router } from 'express';
import authRoutes from './auth.routes.js';
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
import lmsRoutes from './lms.routes.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as lmsController from '../controllers/lms.controller.js';
import { PROVIDER_KEYS } from '../services/lms/index.js';

const router = Router();

router.use('/auth', authRoutes);
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

export default router;
