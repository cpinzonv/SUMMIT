import { Router } from 'express';
import authRoutes from './auth.routes.js';
import classesRoutes from './classes.routes.js';
import assignmentsRoutes from './assignments.routes.js';
import gradesRoutes from './grades.routes.js';
import archivesRoutes from './archives.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/classes', classesRoutes); // create/list assignments nested here
router.use('/assignments', assignmentsRoutes); // update/delete by id
router.use('/grades', gradesRoutes);
router.use('/archives', archivesRoutes);

export default router;
