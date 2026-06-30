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
});

export async function submit(req, res) {
  const result = await gradeService.submitGrade(req.user.id, req.body);
  res.status(201).json(result);
}

export async function simulate(req, res) {
  res.json(await gradeService.simulateGrade(req.user.id, req.params.id, req.body.targetGrade));
}
