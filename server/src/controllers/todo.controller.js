import { z } from 'zod';
import * as todo from '../services/todo.service.js';

export const stageParams = z.object({
  source: z.enum(['assignment', 'task']),
  id: z.string().uuid('Invalid id'),
});
export const stageBody = z.object({
  stage: z.enum(['backlog', 'planning', 'not_started', 'in_progress', 'done']),
});

export async function list(req, res) {
  res.json({ cards: await todo.listTodo(req.user.id) });
}

export async function moveStage(req, res) {
  await todo.setStage(req.user.id, req.params.source, req.params.id, req.body.stage);
  res.status(204).end();
}
