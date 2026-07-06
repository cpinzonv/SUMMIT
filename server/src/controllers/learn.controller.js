import { z } from 'zod';
import * as flashcards from '../services/flashcard.service.js';
import * as learn from '../services/learn.service.js';
import * as quizzes from '../services/quiz.service.js';
import * as guides from '../services/studyGuide.service.js';
import * as mindmaps from '../services/mindMap.service.js';
import * as podcasts from '../services/podcast.service.js';
import * as analytics from '../services/learnAnalytics.service.js';

const difficulty = z.enum(['easy', 'medium', 'hard']);
const sourceType = z.enum(['note', 'file', 'transcript']);

// ---- validation schemas ----
export const classIdParam = z.object({ classId: z.string().uuid('Invalid class id') });
export const cardIdParam = z.object({ cardId: z.string().uuid('Invalid card id') });
export const deckIdParam = z.object({ deckId: z.string().uuid('Invalid deck id') });
export const sessionIdParam = z.object({ sessionId: z.string().uuid('Invalid session id') });

export const listQuery = z.object({
  tag: z.string().optional(),
  difficulty: difficulty.optional(),
});

const cardType = z.enum(['basic', 'cloze', 'image', 'math']);
export const createCardSchema = z
  .object({
    question: z.string().min(1, 'Question is required').max(2000),
    answer: z.string().max(4000).optional(), // optional for cloze/image cards
    explanation: z.string().max(4000).optional(),
    tags: z.array(z.string().max(40)).max(8).optional(),
    difficulty: difficulty.optional(),
    cardType: cardType.optional(),
    clozeParts: z.array(z.object({ id: z.string(), text: z.string() }).passthrough()).optional(),
    imageUrl: z.string().max(2000).optional(),
    occlusionShapes: z.array(z.object({}).passthrough()).optional(),
    latexContent: z.string().max(4000).optional(),
    sourceType: sourceType.optional(),
    sourceId: z.string().uuid().optional(),
  })
  .refine((o) => (o.cardType && o.cardType !== 'basic') || (o.answer && o.answer.length > 0), {
    message: 'Answer is required for basic cards',
    path: ['answer'],
  });

export const updateCardSchema = z
  .object({
    question: z.string().min(1).max(2000).optional(),
    answer: z.string().min(1).max(4000).optional(),
    explanation: z.string().max(4000).nullable().optional(),
    tags: z.array(z.string().max(40)).max(8).optional(),
    difficulty: difficulty.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const generateSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
  sourceType: sourceType.optional(),
  // Accepted (and currently ignored server-side) so the client can send the
  // user's generation options; defaults are used until wired up.
  style: z.enum(['default', 'occlusion', 'cloze', 'qa']).optional(),
  notes: z.array(z.string()).optional(),
});


export const dueQuery = z.object({
  classId: z.string().uuid().optional(),
  deckId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const startSessionSchema = z.object({
  classId: z.string().uuid().optional(),
});
export const endSessionSchema = z.object({
  averageConfidence: z.number().min(1).max(5).optional(),
  interruptions: z.number().int().min(0).optional(),
});

// ---- handlers ----
export async function listCards(req, res) {
  const cards = await flashcards.listClassCards(req.user.id, req.params.classId, req.query);
  res.json({ cards });
}

export async function createCard(req, res) {
  const card = await flashcards.createCard(req.user.id, req.params.classId, req.body);
  res.status(201).json({ card });
}

export async function generate(req, res) {
  const cards = await flashcards.generateCards(req.user.id, req.params.classId, req.body);
  res.status(201).json({ cards });
}

// Decks — Anki-style grouping of a class's cards (typically one per source note).
export async function listDecks(req, res) {
  res.json({ decks: await flashcards.listClassDecks(req.user.id, req.params.classId) });
}
export async function deckCards(req, res) {
  res.json({ cards: await flashcards.listDeckCards(req.user.id, req.params.deckId) });
}
export const updateDeckSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(120) });
export async function updateDeck(req, res) {
  res.json({ deck: await flashcards.updateDeck(req.user.id, req.params.deckId, req.body) });
}

export async function updateCard(req, res) {
  const card = await flashcards.updateCard(req.user.id, req.params.cardId, req.body);
  res.json({ card });
}

export async function removeCard(req, res) {
  await flashcards.deleteCard(req.user.id, req.params.cardId);
  res.status(204).end();
}

// Study actions: bury (return in ~1 day) and suspend (hide until unsuspended).
export async function buryCard(req, res) {
  res.json({ card: await flashcards.buryCard(req.user.id, req.params.cardId) });
}

export async function suspendCard(req, res) {
  res.json({ card: await flashcards.suspendCard(req.user.id, req.params.cardId) });
}

export async function due(req, res) {
  const rows = await learn.getDueCards(req.user.id, {
    classId: req.query.classId,
    deckId: req.query.deckId,
    limit: req.query.limit,
  });
  // Reuse the public card shape (rows carry the joined columns), adding the
  // current scheduling phase so the review UI knows which badges to show.
  res.json({
    cards: rows.map((r) => ({
      ...flashcards.toPublicCard(r),
      className: r.class_name,
      phase: r.phase,
      learningStep: r.learning_step,
      lapses: r.lapses,
    })),
  });
}

export async function overview(req, res) {
  res.json(await learn.getOverview(req.user.id));
}

export async function startSession(req, res) {
  const session = await learn.startSession(req.user.id, req.body.classId);
  res.status(201).json({ session });
}

export async function endSession(req, res) {
  const session = await learn.endSession(req.user.id, req.params.sessionId, req.body);
  res.json({ session });
}

// ===========================================================================
// Premium Learn formats — quizzes, study guides, mind maps, podcasts.
// (Generate endpoints are premium-gated in the router; reads are owner-scoped.)
// ===========================================================================

export const genSourceSchema = z.object({
  sourceType: sourceType.optional(),
  sourceId: z.string().uuid().optional(), // accepted for API parity; generators are class-scoped
});
export const quizGenSchema = genSourceSchema.extend({
  questionCount: z.coerce.number().int().min(3).max(20).optional(),
});
export const quizIdParam = z.object({ quizId: z.string().uuid('Invalid quiz id') });
export const guideIdParam = z.object({ guideId: z.string().uuid('Invalid guide id') });
export const mindmapIdParam = z.object({ mindmapId: z.string().uuid('Invalid mind map id') });
export const podcastIdParam = z.object({ podcastId: z.string().uuid('Invalid podcast id') });

export const submitQuizSchema = z.object({
  answers: z.record(z.string(), z.enum(['A', 'B', 'C', 'D'])).default({}),
  timeSpentSeconds: z.number().int().min(0).optional(),
});
export const markGuideSchema = z
  .object({ completed: z.boolean().optional(), bookmarked: z.boolean().optional() })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
export const listenSchema = z.object({ completionPercent: z.coerce.number().min(0).max(100) });

// ---- quizzes ----
export async function genQuiz(req, res) {
  res.status(201).json(await quizzes.generateQuiz(req.user.id, req.params.classId, req.body));
}
export async function listQuizzes(req, res) {
  res.json({ quizzes: await quizzes.listClassQuizzes(req.user.id, req.params.classId) });
}
export async function getQuiz(req, res) {
  res.json(await quizzes.getQuizForTaking(req.user.id, req.params.quizId));
}
export async function submitQuiz(req, res) {
  res.json(await quizzes.submitQuiz(req.user.id, req.params.quizId, req.body));
}

// ---- study guides ----
export async function genGuide(req, res) {
  const guide = await guides.generateStudyGuide(req.user.id, req.params.classId, req.body);
  res.status(201).json({ guide });
}
export async function listGuides(req, res) {
  res.json({ guides: await guides.listClassGuides(req.user.id, req.params.classId) });
}
export async function getGuide(req, res) {
  res.json({ guide: await guides.getGuide(req.user.id, req.params.guideId) });
}
export async function markGuide(req, res) {
  res.json({ guide: await guides.markGuide(req.user.id, req.params.guideId, req.body) });
}

// ---- mind maps ----
export async function genMindMap(req, res) {
  res.status(201).json(await mindmaps.generateMindMap(req.user.id, req.params.classId, req.body));
}
export async function listMindMaps(req, res) {
  res.json({ mindmaps: await mindmaps.listClassMindMaps(req.user.id, req.params.classId) });
}
export async function getMindMap(req, res) {
  res.json(await mindmaps.getMindMap(req.user.id, req.params.mindmapId));
}

// ---- podcasts ----
export async function genPodcast(req, res) {
  const podcast = await podcasts.generatePodcast(req.user.id, req.params.classId, req.body);
  res.status(201).json({ podcast });
}
export async function listPodcasts(req, res) {
  res.json({ podcasts: await podcasts.listClassPodcasts(req.user.id, req.params.classId) });
}
export async function listPodcastVoices(req, res) {
  res.json({ voices: await podcasts.listPodcastVoices() });
}
export async function listenPodcast(req, res) {
  res.json(await podcasts.recordListen(req.user.id, req.params.podcastId, req.body.completionPercent));
}

// ---- detailed analytics ----
export const analyticsQuery = z.object({
  classId: z.string().uuid().optional(),
  timeRange: z.enum(['7days', '30days', 'alltime']).optional(),
});
export async function analyticsUser(req, res) {
  res.json(await analytics.calculateDetailedAnalytics(req.user.id, req.query));
}
export async function analyticsTrending(req, res) {
  res.json(await analytics.getTrends(req.user.id, req.query));
}

// ---- generate-all (orchestrate the premium formats in one call) ----
export async function generateAll(req, res) {
  const { id } = req.user;
  const classId = req.params.classId;
  const opts = req.body;
  const results = {};
  const errors = {};
  // Run sequentially to stay within rate/token limits; collect per-format outcome.
  for (const [key, fn] of [
    ['quiz', () => quizzes.generateQuiz(id, classId, opts)],
    ['studyGuide', () => guides.generateStudyGuide(id, classId, opts)],
    ['mindMap', () => mindmaps.generateMindMap(id, classId, opts)],
    ['podcast', () => podcasts.generatePodcast(id, classId, opts)],
  ]) {
    try {
      results[key] = await fn();
    } catch (err) {
      errors[key] = err?.message || 'failed';
    }
  }
  res.status(201).json({ results, errors });
}
