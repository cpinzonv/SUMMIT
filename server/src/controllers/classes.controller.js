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

const weekday = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

export const createClassSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  code: z.string().optional(),
  term: z.string().optional(),
  credits: z.number().nonnegative().optional(),
  color: z.string().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  meetingDays: z.array(weekday).optional(),
  meetingTime: z.string().optional(),
  attendanceGraded: z.boolean().optional(),
  attendanceWeight: z.number().min(0).max(100).optional(),
  plannerCourseId: z.string().uuid().optional(), // link to a planner course
  syllabus: syllabusSchema,
});

// PATCH /api/classes/:id — schedule + basic fields, all optional.
export const updateClassSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
    term: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    startDate: dateString.nullable().optional(),
    endDate: dateString.nullable().optional(),
    meetingDays: z.array(weekday).optional(),
    meetingTime: z.string().nullable().optional(),
    attendanceGraded: z.boolean().optional(),
    attendanceWeight: z.number().min(0).max(100).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const classIdParam = z.object({ id: z.string().uuid('Invalid class id') });

// Supported LMS platforms for the per-class manual link (matches LMS_PROVIDER_KEYS).
const LMS_PLATFORMS = ['canvas', 'blackboard', 'google_classroom', 'brightspace', 'moodle', 'sakai'];

// POST /api/classes/:id/link-lms — { lms, course_id }. course_id is the LMS's
// own course id or URL, entered by the student.
export const linkLmsSchema = z.object({
  lms: z.enum(LMS_PLATFORMS),
  course_id: z.string().trim().min(1, 'Enter the course ID or URL from your LMS').max(500),
});

export async function create(req, res) {
  const created = await classService.createClass(req.user.id, req.body);
  res.status(201).json({ class: created });
}

export async function update(req, res) {
  const updated = await classService.updateClass(req.user.id, req.params.id, req.body);
  res.json({ class: updated });
}

export async function list(req, res) {
  const classes = await classService.listCurrentClasses(req.user.id);
  res.json({ classes });
}

export async function archive(req, res) {
  const result = await classService.archiveClass(req.user.id, req.params.id);
  res.json(result);
}

export async function remove(req, res) {
  await classService.deleteClass(req.user.id, req.params.id);
  res.status(204).end();
}

export async function autoArchive(req, res) {
  const archived = await classService.autoArchiveExpired(req.user.id);
  res.json({ archived, count: archived.length });
}

// POST /api/classes/:id/link-canvas — { course_id }. Verifies via the Canvas
// API using the server admin credentials, then stores the link.
export const linkCanvasSchema = z.object({
  course_id: z.string().trim().min(1, 'Enter your Canvas course ID').max(200),
});

export async function linkCanvas(req, res) {
  const updated = await classService.linkClassCanvas(
    req.user.id,
    req.params.id,
    req.body.course_id,
  );
  res.json({ ok: true, linked_canvas_course: updated.linkedLmsCourseId, class: updated });
}

export async function canvasAssignments(req, res) {
  const result = await classService.getClassCanvasAssignments(req.user.id, req.params.id);
  res.json(result);
}

// POST /api/classes/:id/canvas/sync — pull assignments (+ this user's grades)
// from Canvas into Summit's tables.
export async function canvasSyncNow(req, res) {
  const result = await classService.syncClassFromCanvas(req.user.id, req.params.id);
  const synced = result.assignments.synced;
  res.json({
    ok: true,
    synced,
    message: `Synced ${synced} assignment${synced === 1 ? '' : 's'} from Canvas`,
    ...result,
  });
}

export async function linkLms(req, res) {
  const updated = await classService.linkClassLms(req.user.id, req.params.id, {
    lms: req.body.lms,
    courseId: req.body.course_id,
  });
  res.json({ class: updated });
}
