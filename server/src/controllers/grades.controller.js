import { z } from 'zod';
import * as gradeService from '../services/grade.service.js';

export const submitGradeSchema = z.object({
  assignmentId: z.string().uuid('Invalid assignment id'),
  pointsEarned: z.number().nonnegative('pointsEarned must be >= 0'),
  // Optional: defaults to the assignment's point_value on the server.
  pointsPossible: z.number().positive().optional(),
  feedback: z.string().optional(),
});

export const gradeSimSchema = z.object({
  targetGrade: z.union([z.string().min(1), z.number()]),
  // Optional: simulate for ONE ungraded assignment instead of all remaining work.
  assignmentId: z.string().uuid().optional(),
});

export const assignmentIdParam = z.object({
  assignmentId: z.string().uuid('Invalid assignment id'),
});

export async function submit(req, res) {
  const result = await gradeService.submitGrade(req.user.id, req.body);
  res.status(201).json(result);
}

/** Clear a grade (delete the record) so the assignment is ungraded again. */
export async function clear(req, res) {
  const result = await gradeService.clearGrade(req.user.id, req.params.assignmentId);
  res.json(result);
}

export async function simulate(req, res) {
  res.json(
    await gradeService.simulateGrade(
      req.user.id,
      req.params.id,
      req.body.targetGrade,
      req.body.assignmentId,
    ),
  );
}
