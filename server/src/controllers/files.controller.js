import { z } from 'zod';
import * as fileService from '../services/file.service.js';
import { AppError } from '../utils/AppError.js';
import { logAudit } from '../services/audit.service.js';

export const fileIdParam = z.object({ fileId: z.string().uuid('Invalid file id') });

export async function list(req, res) {
  const files = await fileService.listFiles(req.user.id, req.params.id);
  logAudit(req, {
    action: 'record.view',
    targetType: 'file',
    targetId: req.params.id,
    subjectStudentId: req.user.id,
    metadata: { scope: 'class-list', count: files.length },
  });
  res.json({ files });
}

export async function upload(req, res) {
  if (!req.file) throw AppError.badRequest('No file uploaded.');
  const file = await fileService.createFile(req.user.id, req.params.id, req.file, req.body.category);
  res.status(201).json(file);
}

export async function download(req, res) {
  const { filename, mimeType, buffer } = await fileService.getFileForDownload(req.user.id, req.params.fileId);
  // Pulling the raw bytes (recordings, syllabi, submissions) is an export.
  logAudit(req, {
    action: 'record.export',
    targetType: 'file',
    targetId: req.params.fileId,
    subjectStudentId: req.user.id,
  });
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  res.send(buffer);
}

export async function remove(req, res) {
  await fileService.deleteFile(req.user.id, req.params.fileId);
  logAudit(req, {
    action: 'record.delete',
    targetType: 'file',
    targetId: req.params.fileId,
    subjectStudentId: req.user.id,
  });
  res.status(204).end();
}
