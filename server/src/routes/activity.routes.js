/**
 * Activities — 3-level (Activity → Project → Task). Owner-scoped via the service.
 * Mounted at /api/activities. See docs/activities.md.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as a from '../controllers/activity.controller.js';

const router = Router();
router.use(requireAuth);

// Task routes (by task id) — most specific first, so they never collide with /:id.
router.patch('/tasks/:taskId', validate(a.taskIdParam, 'params'), validate(a.updateTaskSchema), asyncHandler(a.updateTask));
router.delete('/tasks/:taskId', validate(a.taskIdParam, 'params'), asyncHandler(a.removeTask));

// Project routes (by project id).
router.patch('/projects/:projectId', validate(a.projectIdParam, 'params'), validate(a.updateProjectSchema), asyncHandler(a.updateProject));
router.post('/projects/:projectId/stage', validate(a.projectIdParam, 'params'), validate(a.stageSchema), asyncHandler(a.projectStage));
router.post('/projects/:projectId/tasks', validate(a.projectIdParam, 'params'), validate(a.addTaskSchema), asyncHandler(a.addTask));
router.delete('/projects/:projectId', validate(a.projectIdParam, 'params'), asyncHandler(a.removeProject));

// Activity routes.
router.get('/', asyncHandler(a.list));
router.post('/', validate(a.createSchema), asyncHandler(a.create));
router.get('/:id', validate(a.idParam, 'params'), asyncHandler(a.get));
router.patch('/:id', validate(a.idParam, 'params'), validate(a.updateSchema), asyncHandler(a.update));
router.delete('/:id', validate(a.idParam, 'params'), asyncHandler(a.remove));
router.post('/:id/projects', validate(a.idParam, 'params'), validate(a.addProjectSchema), asyncHandler(a.addProject));

export default router;
