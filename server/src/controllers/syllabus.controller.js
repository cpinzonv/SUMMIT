import * as syllabusService from '../services/syllabus.service.js';
import { AppError } from '../utils/AppError.js';

export async function extractSyllabus(req, res) {
  if (!req.file) {
    throw AppError.badRequest('No file uploaded. Send a PDF in the "file" field.');
  }
  if (req.file.mimetype !== 'application/pdf') {
    throw AppError.badRequest('Uploaded file must be a PDF.');
  }
  const syllabus = await syllabusService.extractSyllabus(req.file.buffer);
  res.json({ syllabus });
}
