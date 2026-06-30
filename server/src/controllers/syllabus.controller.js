import * as syllabusService from '../services/syllabus.service.js';
import { AppError } from '../utils/AppError.js';

export async function extractSyllabus(req, res) {
  if (!req.file) {
    throw AppError.badRequest('No file uploaded. Send a PDF, DOCX, JPG, or PNG in the "file" field.');
  }
  // Allowed MIME types are enforced by the multer fileFilter.
  const syllabus = await syllabusService.extractSyllabus(req.file);
  res.json({ syllabus });
}
