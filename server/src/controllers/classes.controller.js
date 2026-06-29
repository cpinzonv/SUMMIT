import { z } from 'zod';
import * as classService from '../services/class.service.js';

// A calendar date (YYYY-MM-DD) or full ISO timestamp; stored in a DATE column.
const dateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const meetingTime = z.object({
  day: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string().optional(),
});

const gradingCategory = z.object({
  name: z.string(),
  weight: z.number().min(0).max(1),
});

const syllabusSchema = z
  .object({
    instructor: z.string().optional(),
    instructorEmail: z.string().email().optional(),
    location: z.string().optional(),
    meetingTimes: z.array(meetingTime).optional(),
    gradingScheme: z.array(gradingCategory).optional(),
    syllabusUrl: z.string().url().optional(),
  })
  .optional();

export const createClassSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  code: z.string().optional(),
  term: z.string().optional(),
  credits: z.number().nonnegative().optional(),
  color: z.string().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  syllabus: syllabusSchema,
});

export const classIdParam = z.object({ id: z.string().uuid('Invalid class id') });

export async function create(req, res) {
  const created = await classService.createClass(req.user.id, req.body);
  res.status(201).json({ class: created });
}

export async function list(req, res) {
  const classes = await classService.listCurrentClasses(req.user.id);
  res.json({ classes });
}

export async function archive(req, res) {
  const result = await classService.archiveClass(req.user.id, req.params.id);
  res.json(result);
}
