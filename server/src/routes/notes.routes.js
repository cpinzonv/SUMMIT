import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as notes from '../controllers/notes.controller.js';

// Note update/delete by id + cross-class search. Create/list are nested under
// /api/classes/:id/notes.
const router = Router();

router.use(requireAuth);

router.get('/', validate(notes.listQuery, 'query'), asyncHandler(notes.search));

router.patch(
  '/:noteId',
  validate(notes.noteIdParam, 'params'),
  validate(notes.updateNoteSchema),
  asyncHandler(notes.update),
);
router.delete(
  '/:noteId',
  validate(notes.noteIdParam, 'params'),
  asyncHandler(notes.remove),
);

export default router;
