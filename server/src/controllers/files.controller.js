import { z } from 'zod';
import * as fileService from '../services/file.service.js';
import { AppError } from '../utils/AppError.js';

export const fileIdParam = z.object({ fileId: z.string().uuid('Invalid file id') });

export async function list(req, res) {
  res.json({ files: await fileService.listFiles(req.user.id, req.params.id) });
}

export async function upload(req, res) {
  if (!req.file) throw AppError.badRequest('No file uploaded.');
  const file = await fileService.createFile(
    req.user.id,
    req.params.id,
    req.file,
    req.body.category,
    req.body.assignmentId || null,
  );
  res.status(201).json(file);
}

export async function download(req, res) {
  const { filename, mimeType, buffer } = await fileService.getFileForDownload(req.user.id, req.params.fileId);
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  res.send(buffer);
}

export async function remove(req, res) {
  await fileService.deleteFile(req.user.id, req.params.fileId);
  res.status(204).end();
}
