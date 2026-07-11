/**
 * Learn tab — flashcards + spaced repetition. Everything is owner-scoped via
 * the service layer. Mounted at /api/learn.
 *   GET    /classes/:classId/cards         list a class's cards
 *   POST   /classes/:classId/cards         author a card
 *   POST   /classes/:classId/generate      AI-generate cards (503 w/o API key)
 *   PATCH  /cards/:cardId                  edit a card
 *   DELETE /cards/:cardId                  delete a card
 *   GET    /due                            cards due for review (optional ?classId)
 *   GET    /stats                          learning overview (streak, mastery, due)
 *   POST   /sessions                       start a study session
 *   PATCH  /sessions/:sessionId            end a study session
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';
import { enforceUsage } from '../middleware/enforceUsage.js';
import { aiLimiter } from '../middleware/rateLimit.js';
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
  enforceUsage('ai_cards', { amount: (req) => Number(req.body?.count) || 10 }), // free: 50 lifetime
  asyncHandler(learn.generate),
);

// Decks — list a class's decks, and the cards within a deck.
router.get(
  '/classes/:classId/decks',
  validate(learn.classIdParam, 'params'),
  asyncHandler(learn.listDecks),
);
router.get(
  '/decks/:deckId/cards',
  validate(learn.deckIdParam, 'params'),
  asyncHandler(learn.deckCards),
);
router.patch(
  '/decks/:deckId',
  validate(learn.deckIdParam, 'params'),
  validate(learn.updateDeckSchema),
  asyncHandler(learn.updateDeck),
);
router.delete('/decks/:deckId', validate(learn.deckIdParam, 'params'), asyncHandler(learn.removeDeck));

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
// Study actions: bury (return in ~1 day) / suspend (hide until unsuspended).
router.post(
  '/cards/:cardId/bury',
  validate(learn.cardIdParam, 'params'),
  asyncHandler(learn.buryCard),
);
router.post(
  '/cards/:cardId/suspend',
  validate(learn.cardIdParam, 'params'),
  asyncHandler(learn.suspendCard),
);

router.get('/due', validate(learn.dueQuery, 'query'), asyncHandler(learn.due));
router.get('/stats', asyncHandler(learn.overview));

// Detailed per-format / topic / time / trend analytics (free — about your own usage).
router.get('/analytics/user', validate(learn.analyticsQuery, 'query'), asyncHandler(learn.analyticsUser));
router.get('/analytics/trending', validate(learn.analyticsQuery, 'query'), asyncHandler(learn.analyticsTrending));

router.post('/sessions', validate(learn.startSessionSchema), asyncHandler(learn.startSession));
router.patch(
  '/sessions/:sessionId',
  validate(learn.sessionIdParam, 'params'),
  validate(learn.endSessionSchema),
  asyncHandler(learn.endSession),
);

// ---- Premium formats (quizzes / guides / mind maps / podcasts) -------------
// Generation is gated per-feature by requirePremium; reads/submissions are
// owner-scoped only (a downgraded user can still revisit content they made).

// Quizzes
router.post(
  '/classes/:classId/quizzes/generate',
  requirePremium('quizzes'),
  validate(learn.classIdParam, 'params'),
  validate(learn.quizGenSchema),
  aiLimiter,
  enforceUsage('ai_requests'),
  asyncHandler(learn.genQuiz),
);
router.get('/classes/:classId/quizzes', validate(learn.classIdParam, 'params'), asyncHandler(learn.listQuizzes));
router.get('/quizzes/:quizId', validate(learn.quizIdParam, 'params'), asyncHandler(learn.getQuiz));
router.delete('/quizzes/:quizId', validate(learn.quizIdParam, 'params'), asyncHandler(learn.removeQuiz));
router.post(
  '/quizzes/:quizId/submit',
  validate(learn.quizIdParam, 'params'),
  validate(learn.submitQuizSchema),
  asyncHandler(learn.submitQuiz),
);

// Study guides
router.post(
  '/classes/:classId/guides/generate',
  requirePremium('studyGuides'),
  validate(learn.classIdParam, 'params'),
  validate(learn.genSourceSchema),
  aiLimiter,
  enforceUsage('ai_requests'),
  asyncHandler(learn.genGuide),
);
router.get('/classes/:classId/guides', validate(learn.classIdParam, 'params'), asyncHandler(learn.listGuides));
router.get('/guides/:guideId', validate(learn.guideIdParam, 'params'), asyncHandler(learn.getGuide));
router.delete('/guides/:guideId', validate(learn.guideIdParam, 'params'), asyncHandler(learn.removeGuide));
router.post(
  '/guides/:guideId/read',
  validate(learn.guideIdParam, 'params'),
  validate(learn.markGuideSchema),
  asyncHandler(learn.markGuide),
);

// Mind maps
router.post(
  '/classes/:classId/mindmaps/generate',
  requirePremium('mindMaps'),
  validate(learn.classIdParam, 'params'),
  validate(learn.genSourceSchema),
  aiLimiter,
  enforceUsage('ai_requests'),
  asyncHandler(learn.genMindMap),
);
router.get('/classes/:classId/mindmaps', validate(learn.classIdParam, 'params'), asyncHandler(learn.listMindMaps));
router.get('/mindmaps/:mindmapId', validate(learn.mindmapIdParam, 'params'), asyncHandler(learn.getMindMap));

// Podcasts
router.post(
  '/classes/:classId/podcasts/generate',
  // Metered, not premium-gated: free tier gets 1 lifetime podcast (standard voice).
  // Premium AI voices require Max; the counter caps pro at 3/mo and max at 10/mo.
  validate(learn.classIdParam, 'params'),
  validate(learn.podcastGenSchema),
  enforceUsage('podcasts', { premiumVoice: (req) => Boolean(req.body?.premiumVoice) }),
  asyncHandler(learn.genPodcast),
);
router.get('/classes/:classId/podcasts', validate(learn.classIdParam, 'params'), asyncHandler(learn.listPodcasts));
router.delete('/podcasts/:podcastId', validate(learn.podcastIdParam, 'params'), asyncHandler(learn.removePodcast));
router.get('/podcast-voices', asyncHandler(learn.listPodcastVoices));
router.post(
  '/podcasts/:podcastId/listen',
  validate(learn.podcastIdParam, 'params'),
  validate(learn.listenSchema),
  asyncHandler(learn.listenPodcast),
);

// Generate every premium format for a class in one call.
router.post(
  '/classes/:classId/generate-all',
  requirePremium('quizzes'),
  validate(learn.classIdParam, 'params'),
  validate(learn.genSourceSchema),
  aiLimiter,
  enforceUsage('ai_requests', { amount: 3 }),
  asyncHandler(learn.generateAll),
);

export default router;
