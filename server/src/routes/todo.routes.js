/**
 * To-Do — unified feed for the calendar + Kanban board. Mounted at /api/todo.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as todo from '../controllers/todo.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(todo.list));
router.patch(
  '/:source/:id/stage',
  validate(todo.stageParams, 'params'),
  validate(todo.stageBody),
  asyncHandler(todo.moveStage),
);

export default router;
