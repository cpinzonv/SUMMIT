import { z } from 'zod';
import * as deckStudy from '../services/deckStudy.service.js';

export const cardIdParam = z.object({ id: z.string().uuid('Invalid card id') });
export const deckIdParam = z.object({ id: z.string().uuid('Invalid deck id') });
export const studyDeckParam = z.object({ deckId: z.string().uuid('Invalid deck id') });

export const rateSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  // Time on this card, in seconds. Accept large values (a backgrounded tab can
  // report hours) and let the service clamp — don't reject the rating over it.
  timeSpentSeconds: z.coerce.number().int().min(0).max(86400).optional(),
});
export const deadlineSchema = z.object({ deadline: z.string().min(1, 'Deadline is required') });
export const settingsSchema = z
  .object({
    deadline: z.string().nullable().optional(),
    dailyNewCardLimit: z.coerce.number().int().min(0).max(1000).optional(),
    maxCardsPerSession: z.coerce.number().int().min(1).max(1000).optional(),
    interleavingEnabled: z.boolean().optional(),
    userDailyStudyLimit: z.coerce.number().int().min(1).max(10000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export async function rate(req, res) {
  res.json(await deckStudy.rateCard(req.user.id, req.params.id, req.body.rating, req.body.timeSpentSeconds));
}
export async function studyPlan(req, res) {
  res.json(await deckStudy.getStudyPlan(req.user.id, req.params.id));
}
export async function setDeadline(req, res) {
  res.json(await deckStudy.setDeadline(req.user.id, req.params.id, req.body.deadline));
}
export async function getSettings(req, res) {
  res.json(await deckStudy.getDeckSettings(req.user.id, req.params.id));
}
export async function updateSettings(req, res) {
  res.json(await deckStudy.updateDeckSettings(req.user.id, req.params.id, req.body));
}
export async function studyToday(req, res) {
  res.json(await deckStudy.getStudyToday(req.user.id, req.params.deckId));
}
