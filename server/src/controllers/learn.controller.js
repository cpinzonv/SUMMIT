import { z } from 'zod';
import * as flashcards from '../services/flashcard.service.js';
import * as learn from '../services/learn.service.js';

const difficulty = z.enum(['easy', 'medium', 'hard']);
const sourceType = z.enum(['note', 'file', 'transcript']);

// ---- validation schemas ----
export const classIdParam = z.object({ classId: z.string().uuid('Invalid class id') });
export const cardIdParam = z.object({ cardId: z.string().uuid('Invalid card id') });
export const sessionIdParam = z.object({ sessionId: z.string().uuid('Invalid session id') });

export const listQuery = z.object({
  tag: z.string().optional(),
  difficulty: difficulty.optional(),
});

export const createCardSchema = z.object({
  question: z.string().min(1, 'Question is required').max(2000),
  answer: z.string().min(1, 'Answer is required').max(4000),
  explanation: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).max(8).optional(),
  difficulty: difficulty.optional(),
  sourceType: sourceType.optional(),
  sourceId: z.string().uuid().optional(),
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
  count: z.number().int().min(1).max(40).optional(),
  sourceType: sourceType.optional(),
});

export const reviewSchema = z.object({
  confidence: z.number().int().min(1).max(5),
  timeSpentSeconds: z.number().int().min(0).max(3600).optional(),
  sessionId: z.string().uuid().optional(),
});

export const dueQuery = z.object({
  classId: z.string().uuid().optional(),
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

export async function updateCard(req, res) {
  const card = await flashcards.updateCard(req.user.id, req.params.cardId, req.body);
  res.json({ card });
}

export async function removeCard(req, res) {
  await flashcards.deleteCard(req.user.id, req.params.cardId);
  res.status(204).end();
}

export async function due(req, res) {
  const rows = await learn.getDueCards(req.user.id, {
    classId: req.query.classId,
    limit: req.query.limit,
  });
  // Reuse the public card shape (rows carry the joined columns).
  res.json({ cards: rows.map((r) => ({ ...flashcards.toPublicCard(r), className: r.class_name })) });
}

export async function review(req, res) {
  const result = await learn.reviewCard(req.user.id, req.params.cardId, req.body);
  res.json(result);
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
