import { z } from 'zod';
import * as attendanceService from '../services/attendance.service.js';
import { logAudit } from '../services/audit.service.js';

const dateString = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Date must be YYYY-MM-DD');

export const markSchema = z.object({
  sessionDate: dateString,
  status: z.enum(['present', 'absent', 'late', 'excused']),
  note: z.string().optional(),
});

export const attendanceIdParam = z.object({
  attendanceId: z.string().uuid('Invalid attendance id'),
});

export async function list(req, res) {
  const result = await attendanceService.listAttendance(req.user.id, req.params.id);
  logAudit(req, {
    action: 'record.view',
    targetType: 'attendance',
    targetId: req.params.id,
    subjectStudentId: req.user.id,
    metadata: { scope: 'class-list', count: result?.sessions?.length ?? 0 },
  });
  res.json(result);
}

export async function mark(req, res) {
  const record = await attendanceService.markAttendance(
    req.user.id,
    req.params.id,
    req.body,
  );
  res.status(201).json({ record });
}

export async function remove(req, res) {
  await attendanceService.deleteAttendance(req.user.id, req.params.attendanceId);
  res.status(204).end();
}
