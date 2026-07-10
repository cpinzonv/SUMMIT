import { z } from 'zod';
import * as classService from '../services/class.service.js';
import { logAudit } from '../services/audit.service.js';

// A calendar date (YYYY-MM-DD) or full ISO timestamp; stored in a DATE column.
const dateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

// Local wall-clock 'HH:MM' (24h). Zero-padded so lexicographic compare == chronological.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const weekdayToken = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

const meetingTime = z
  .object({
    day: weekdayToken,
    start: z.string().regex(HHMM, 'start must be HH:MM'),
    end: z.string().regex(HHMM, 'end must be HH:MM').optional(),
    location: z.string().optional(),
  })
  // When both times are present, the class can't end before it starts.
  .refine((mt) => !mt.end || mt.end > mt.start, { message: 'end time must be after start time', path: ['end'] });

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
    // Editing the meeting schedule (rich model). meeting_days is re-derived from
    // this server-side, so the timetable, calendar, and attendance stay in sync.
    syllabus: z
      .object({
        meetingTimes: z.array(meetingTime).optional(),
        location: z.string().nullable().optional(),
      })
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const classIdParam = z.object({ id: z.string().uuid('Invalid class id') });

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
  // Bulk read of the student's classes, which carry grade roll-ups and syllabus data.
  logAudit(req, {
    action: 'record.view',
    targetType: 'class',
    subjectStudentId: req.user.id,
    metadata: { scope: 'list', count: classes.length },
  });
  res.json({ classes });
}

export async function archive(req, res) {
  const result = await classService.archiveClass(req.user.id, req.params.id);
  // Archiving snapshots the class + assignments + grades into an export record.
  logAudit(req, {
    action: 'record.export',
    targetType: 'class',
    targetId: req.params.id,
    subjectStudentId: req.user.id,
    metadata: { op: 'archive' },
  });
  res.json(result);
}

export async function remove(req, res) {
  await classService.deleteClass(req.user.id, req.params.id);
  logAudit(req, {
    action: 'record.delete',
    targetType: 'class',
    targetId: req.params.id,
    subjectStudentId: req.user.id,
  });
  res.status(204).end();
}

export async function autoArchive(req, res) {
  const archived = await classService.autoArchiveExpired(req.user.id);
  res.json({ archived, count: archived.length });
}
