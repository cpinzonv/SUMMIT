/**
 * Learn tab — flashcards + spaced repetition. Everything is owner-scoped via
 * the service layer. Mounted at /api/learn.
 *   GET    /classes/:classId/cards         list a class's cards
 *   POST   /classes/:classId/cards         author a card
 *   POST   /classes/:classId/generate      AI-generate cards (503 w/o API key)
 *   PATCH  /cards/:cardId                  edit a card
 *   DELETE /cards/:cardId                  delete a card
 *   POST   /cards/:cardId/review           record an SM-2 review
 *   GET    /due                            cards due for review (optional ?classId)
 *   GET    /stats                          learning overview (streak, mastery, due)
 *   POST   /sessions                       start a study session
 *   PATCH  /sessions/:sessionId            end a study session
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as learn from '../controllers/learn.controller.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/classes/:classId/cards',
  validate(learn.classIdParam, 'params'),
  validate(learn.listQuery, 'query'),
  asyncHandler(learn.listCards),
);
router.post(
  '/classes/:classId/cards',
  validate(learn.classIdParam, 'params'),
  validate(learn.createCardSchema),
  asyncHandler(learn.createCard),
);
router.post(
  '/classes/:classId/generate',
  validate(learn.classIdParam, 'params'),
  validate(learn.generateSchema),
  asyncHandler(learn.generate),
);

router.patch(
  '/cards/:cardId',
  validate(learn.cardIdParam, 'params'),
  validate(learn.updateCardSchema),
  asyncHandler(learn.updateCard),
);
router.delete(
  '/cards/:cardId',
  validate(learn.cardIdParam, 'params'),
  asyncHandler(learn.removeCard),
);
router.post(
  '/cards/:cardId/review',
  validate(learn.cardIdParam, 'params'),
  validate(learn.reviewSchema),
  asyncHandler(learn.review),
);

router.get('/due', validate(learn.dueQuery, 'query'), asyncHandler(learn.due));
router.get('/stats', asyncHandler(learn.overview));

router.post('/sessions', validate(learn.startSessionSchema), asyncHandler(learn.startSession));
router.patch(
  '/sessions/:sessionId',
  validate(learn.sessionIdParam, 'params'),
  validate(learn.endSessionSchema),
  asyncHandler(learn.endSession),
);

export default router;
