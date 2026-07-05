import { z } from 'zod';
import * as activities from '../services/activity.service.js';

const nullableStr = z.string().max(2000).nullable().optional();
const dateStr = z.string().nullable().optional(); // ISO / date string; optional (Decision #6)

const taskInput = z.object({
  title: z.string().max(300).optional().default(''),
  description: nullableStr,
  dueDate: dateStr,
  plannedDate: dateStr,
});

export const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: nullableStr,
  color: z.string().max(20).nullable().optional(),
  kind: z.string().max(30).optional(),
  tasks: z.array(taskInput).max(50).optional(),
});

export const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: nullableStr,
    color: z.string().max(20).nullable().optional(),
    kind: z.string().max(30).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const stageSchema = z.object({ stage: z.enum(['backlog', 'active', 'in_progress', 'done']) });

export const addTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: nullableStr,
  dueDate: dateStr,
  plannedDate: dateStr,
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: nullableStr,
    dueDate: dateStr,
    plannedDate: dateStr,
    status: z.enum(['not_started', 'in_progress', 'done']).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const idParam = z.object({ id: z.string().uuid('Invalid activity id') });
export const taskIdParam = z.object({ taskId: z.string().uuid('Invalid task id') });

export async function list(req, res) {
  res.json(await activities.listActivities(req.user.id));
}
export async function create(req, res) {
  res.status(201).json({ activity: await activities.createActivity(req.user.id, req.body) });
}
export async function get(req, res) {
  res.json({ activity: await activities.getActivity(req.user.id, req.params.id) });
}
export async function update(req, res) {
  res.json({ activity: await activities.updateActivity(req.user.id, req.params.id, req.body) });
}
export async function stage(req, res) {
  res.json({ activity: await activities.setStage(req.user.id, req.params.id, req.body.stage) });
}
export async function remove(req, res) {
  await activities.deleteActivity(req.user.id, req.params.id);
  res.status(204).end();
}
export async function addTask(req, res) {
  res.status(201).json({ activity: await activities.addTask(req.user.id, req.params.id, req.body) });
}
export async function updateTask(req, res) {
  res.json({ activity: await activities.updateTask(req.user.id, req.params.taskId, req.body) });
}
export async function removeTask(req, res) {
  res.json({ activity: await activities.deleteTask(req.user.id, req.params.taskId) });
}
