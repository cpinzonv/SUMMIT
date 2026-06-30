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
import { premiumGate } from '../middleware/premiumGate.js';
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

// ---- Premium formats (quizzes / guides / mind maps / podcasts) -------------
// Generation is gated by premiumGate; reads/submissions are owner-scoped only
// (so a user who downgrades can still revisit content they already generated).

// Quizzes
router.post(
  '/classes/:classId/quizzes/generate',
  premiumGate,
  validate(learn.classIdParam, 'params'),
  validate(learn.quizGenSchema),
  asyncHandler(learn.genQuiz),
);
router.get('/classes/:classId/quizzes', validate(learn.classIdParam, 'params'), asyncHandler(learn.listQuizzes));
router.get('/quizzes/:quizId', validate(learn.quizIdParam, 'params'), asyncHandler(learn.getQuiz));
router.post(
  '/quizzes/:quizId/submit',
  validate(learn.quizIdParam, 'params'),
  validate(learn.submitQuizSchema),
  asyncHandler(learn.submitQuiz),
);

// Study guides
router.post(
  '/classes/:classId/guides/generate',
  premiumGate,
  validate(learn.classIdParam, 'params'),
  validate(learn.genSourceSchema),
  asyncHandler(learn.genGuide),
);
router.get('/classes/:classId/guides', validate(learn.classIdParam, 'params'), asyncHandler(learn.listGuides));
router.get('/guides/:guideId', validate(learn.guideIdParam, 'params'), asyncHandler(learn.getGuide));
router.post(
  '/guides/:guideId/read',
  validate(learn.guideIdParam, 'params'),
  validate(learn.markGuideSchema),
  asyncHandler(learn.markGuide),
);

// Mind maps
router.post(
  '/classes/:classId/mindmaps/generate',
  premiumGate,
  validate(learn.classIdParam, 'params'),
  validate(learn.genSourceSchema),
  asyncHandler(learn.genMindMap),
);
router.get('/classes/:classId/mindmaps', validate(learn.classIdParam, 'params'), asyncHandler(learn.listMindMaps));
router.get('/mindmaps/:mindmapId', validate(learn.mindmapIdParam, 'params'), asyncHandler(learn.getMindMap));

// Podcasts
router.post(
  '/classes/:classId/podcasts/generate',
  premiumGate,
  validate(learn.classIdParam, 'params'),
  validate(learn.genSourceSchema),
  asyncHandler(learn.genPodcast),
);
router.get('/classes/:classId/podcasts', validate(learn.classIdParam, 'params'), asyncHandler(learn.listPodcasts));
router.post(
  '/podcasts/:podcastId/listen',
  validate(learn.podcastIdParam, 'params'),
  validate(learn.listenSchema),
  asyncHandler(learn.listenPodcast),
);

// Generate every premium format for a class in one call.
router.post(
  '/classes/:classId/generate-all',
  premiumGate,
  validate(learn.classIdParam, 'params'),
  validate(learn.genSourceSchema),
  asyncHandler(learn.generateAll),
);

export default router;
