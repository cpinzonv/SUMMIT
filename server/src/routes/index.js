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
import canvasRoutes from './canvas.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/canvas', canvasRoutes); // Canvas/LMS connect + sync + import
router.use('/classes', classesRoutes); // assignments/notes/attendance nested here
router.use('/assignments', assignmentsRoutes); // update/delete by id
router.use('/grades', gradesRoutes);
router.use('/archives', archivesRoutes);
router.use('/notes', notesRoutes); // update/delete by id + cross-class search
router.use('/attendance', attendanceRoutes); // delete by id
router.use('/plan', planRoutes);

export default router;
