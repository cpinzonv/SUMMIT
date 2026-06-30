import { z } from 'zod';
import * as transcriptService from '../services/transcript.service.js';
import { AppError } from '../utils/AppError.js';

const dateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

export const listQuery = z.object({ q: z.string().optional() });

export const createSchema = z.object({
  title: z.string().optional(),
  content: z.string().default(''),
  source: z.enum(['upload', 'paste']).optional(),
  recordedDate: dateString.nullable().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  timestamps: z.array(z.object({ time: z.string(), label: z.string().optional() })).optional(),
});

export const updateSchema = z
  .object({
    title: z.string().min(1).optional(),
    content: z.string().optional(),
    recordedDate: dateString.nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const transcriptIdParam = z.object({
  transcriptId: z.string().uuid('Invalid transcript id'),
});

export async function list(req, res) {
  const transcripts = await transcriptService.listTranscripts(req.user.id, req.params.id, req.query.q || '');
  res.json({ transcripts });
}

export async function create(req, res) {
  const transcript = await transcriptService.createTranscript(req.user.id, req.params.id, req.body);
  res.status(201).json({ transcript });
}

export async function record(req, res) {
  if (!req.file) throw AppError.badRequest('No audio uploaded.');
  const durationSeconds = req.body.durationSeconds ? Number(req.body.durationSeconds) : null;
  const recordedDate = req.body.recordedDate || null;
  const result = await transcriptService.createFromRecording(req.user.id, req.params.id, req.file, {
    durationSeconds,
    recordedDate,
  });
  res.status(201).json(result);
}

export async function update(req, res) {
  const transcript = await transcriptService.updateTranscript(req.user.id, req.params.transcriptId, req.body);
  res.json({ transcript });
}

export async function remove(req, res) {
  await transcriptService.deleteTranscript(req.user.id, req.params.transcriptId);
  res.status(204).end();
}
