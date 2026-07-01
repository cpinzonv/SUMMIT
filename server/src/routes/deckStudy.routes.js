/**
 * Classic SM-2 study routes (full-replacement scheduler).
 *   POST /api/flashcards/:id/rate      rate a card 1–5 (SM-2)
 *   GET  /api/decks/:id/study-plan      deadline-driven pace + projections
 *   POST /api/decks/:id/deadline        set a deadline, get the plan back
 *   GET  /api/decks/:id/settings        deck study settings
 *   POST /api/decks/:id/settings        update settings (limits / interleaving)
 *   GET  /api/study/today/:deckId       today's study queue (respects limits)
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as ds from '../controllers/deckStudy.controller.js';

export const flashcardsRouter = Router();
flashcardsRouter.use(requireAuth);
flashcardsRouter.post(
  '/:id/rate',
  validate(ds.cardIdParam, 'params'),
  validate(ds.rateSchema),
  asyncHandler(ds.rate),
);

export const decksRouter = Router();
decksRouter.use(requireAuth);
decksRouter.get('/:id/study-plan', validate(ds.deckIdParam, 'params'), asyncHandler(ds.studyPlan));
decksRouter.post(
  '/:id/deadline',
  validate(ds.deckIdParam, 'params'),
  validate(ds.deadlineSchema),
  asyncHandler(ds.setDeadline),
);
decksRouter.get('/:id/settings', validate(ds.deckIdParam, 'params'), asyncHandler(ds.getSettings));
decksRouter.post(
  '/:id/settings',
  validate(ds.deckIdParam, 'params'),
  validate(ds.settingsSchema),
  asyncHandler(ds.updateSettings),
);

export const studyRouter = Router();
studyRouter.use(requireAuth);
studyRouter.get('/today/:deckId', validate(ds.studyDeckParam, 'params'), asyncHandler(ds.studyToday));
