import { z } from 'zod';
import * as assignmentService from '../services/assignment.service.js';
import { AppError } from '../utils/AppError.js';
import { logAudit } from '../services/audit.service.js';

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
    instructions: z.string().nullable().optional(),
    workingContent: z.string().nullable().optional(),
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

// Submission text arrives as a multipart form field alongside the optional file.
export const submissionSchema = z.object({
  text: z.string().max(20000).optional(),
});

// Detail-modal schemas.
export const estimateSchema = z.object({
  instructions: z.string().max(200000).optional(),
});
export const renameFileSchema = z.object({
  filename: z.string().min(1, 'Enter a file name').max(255),
});
export const fileIdParam = z.object({
  assignmentId: z.string().uuid('Invalid assignment id'),
  fileId: z.string().uuid('Invalid file id'),
});
export const submissionIdParam = z.object({
  assignmentId: z.string().uuid('Invalid assignment id'),
  submissionId: z.string().uuid('Invalid submission id'),
});
// A new submission: kind + (url for link, text for working). File rides multipart.
export const newSubmissionSchema = z.object({
  kind: z.enum(['file', 'link', 'working']),
  url: z.string().max(2000).optional(),
  text: z.string().max(200000).optional(),
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
  logAudit(req, {
    action: 'record.view',
    targetType: 'assignment',
    targetId: req.params.id,
    subjectStudentId: req.user.id,
    metadata: { scope: 'class-list', count: assignments.length },
  });
  res.json({ assignments });
}

export async function getOne(req, res) {
  const assignment = await assignmentService.getAssignmentForUser(req.user.id, req.params.assignmentId);
  logAudit(req, {
    action: 'record.view',
    targetType: 'assignment',
    targetId: req.params.assignmentId,
    subjectStudentId: req.user.id,
  });
  res.json({ assignment });
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
  logAudit(req, {
    action: 'record.delete',
    targetType: 'assignment',
    targetId: req.params.assignmentId,
    subjectStudentId: req.user.id,
  });
  res.status(204).end();
}

export async function submit(req, res) {
  const file = req.file
    ? { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype }
    : null;
  const assignment = await assignmentService.submitAssignment(req.user.id, req.params.assignmentId, {
    text: req.body?.text,
    file,
  });
  res.json({ assignment });
}

export async function unsubmit(req, res) {
  const assignment = await assignmentService.clearSubmission(req.user.id, req.params.assignmentId);
  res.json({ assignment });
}

/* ---- Detail modal: AI time estimate ------------------------------------ */
export async function estimateTime(req, res) {
  const result = await assignmentService.estimateTime(req.user.id, req.params.assignmentId, req.body?.instructions);
  res.json(result);
}

/* ---- Detail modal: instruction files ----------------------------------- */
export async function listFiles(req, res) {
  res.json({ files: await assignmentService.listInstructionFiles(req.user.id, req.params.assignmentId) });
}
export async function addFile(req, res) {
  if (!req.file) throw new AppError(400, 'No file uploaded.');
  const file = { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype };
  res.status(201).json({ file: await assignmentService.addInstructionFile(req.user.id, req.params.assignmentId, file) });
}
export async function renameFile(req, res) {
  const file = await assignmentService.renameInstructionFile(req.user.id, req.params.assignmentId, req.params.fileId, req.body.filename);
  res.json({ file });
}
export async function removeFile(req, res) {
  await assignmentService.deleteInstructionFile(req.user.id, req.params.assignmentId, req.params.fileId);
  res.status(204).end();
}

/* ---- Detail modal: submission history ---------------------------------- */
export async function listSubmissions(req, res) {
  res.json({ submissions: await assignmentService.listSubmissions(req.user.id, req.params.assignmentId) });
}
export async function addSubmission(req, res) {
  const file = req.file
    ? { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype }
    : null;
  const submission = await assignmentService.addSubmission(req.user.id, req.params.assignmentId, {
    kind: req.body.kind,
    url: req.body.url,
    text: req.body.text,
    file,
  });
  res.status(201).json({ submission });
}
export async function removeSubmission(req, res) {
  await assignmentService.deleteSubmission(req.user.id, req.params.assignmentId, req.params.submissionId);
  res.status(204).end();
}
