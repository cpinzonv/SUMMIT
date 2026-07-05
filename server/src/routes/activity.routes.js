/**
 * Activities — anti-procrastination projects. Owner-scoped via the service.
 * Mounted at /api/activities. See docs/activities.md.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as activities from '../controllers/activity.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(activities.list));
router.post('/', validate(activities.createSchema), asyncHandler(activities.create));

// Sub-task routes (by task id) — declared before /:id so they never collide.
router.patch('/tasks/:taskId', validate(activities.taskIdParam, 'params'), validate(activities.updateTaskSchema), asyncHandler(activities.updateTask));
router.delete('/tasks/:taskId', validate(activities.taskIdParam, 'params'), asyncHandler(activities.removeTask));

router.get('/:id', validate(activities.idParam, 'params'), asyncHandler(activities.get));
router.patch('/:id', validate(activities.idParam, 'params'), validate(activities.updateSchema), asyncHandler(activities.update));
router.delete('/:id', validate(activities.idParam, 'params'), asyncHandler(activities.remove));
router.post('/:id/stage', validate(activities.idParam, 'params'), validate(activities.stageSchema), asyncHandler(activities.stage));
router.post('/:id/tasks', validate(activities.idParam, 'params'), validate(activities.addTaskSchema), asyncHandler(activities.addTask));

export default router;
