import { z } from 'zod';
import * as assignmentService from '../services/assignment.service.js';

const timestamp = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date/time');

const statusEnum = z.enum([
  'not_started',
  'in_progress',
  'submitted',
  'graded',
]);

const priorityEnum = z.enum(['none', 'low', 'medium', 'high']);

export const createAssignmentSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  category: z.string().optional(),
  dueDate: timestamp.optional(),
  plannedDate: timestamp.optional(),
  pointValue: z.number().nonnegative().optional(),
  estimatedHours: z.number().nonnegative().max(999).optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
});

// All fields optional for PATCH. Nullable date/value fields so the client can
// clear them.
export const updateAssignmentSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    dueDate: timestamp.nullable().optional(),
    plannedDate: timestamp.nullable().optional(),
    pointValue: z.number().nonnegative().nullable().optional(),
    estimatedHours: z.number().nonnegative().max(999).nullable().optional(),
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Provide at least one field to update',
  });

export const assignmentIdParam = z.object({
  assignmentId: z.string().uuid('Invalid assignment id'),
});

export async function create(req, res) {
  const created = await assignmentService.createAssignment(
    req.user.id,
    req.params.id,
    req.body,
  );
  res.status(201).json({ assignment: created });
}

export async function list(req, res) {
  const assignments = await assignmentService.listAssignments(
    req.user.id,
    req.params.id,
  );
  res.json({ assignments });
}

export async function update(req, res) {
  const assignment = await assignmentService.updateAssignment(
    req.user.id,
    req.params.assignmentId,
    req.body,
  );
  res.json({ assignment });
}

export async function remove(req, res) {
  await assignmentService.deleteAssignment(req.user.id, req.params.assignmentId);
  res.status(204).end();
}
