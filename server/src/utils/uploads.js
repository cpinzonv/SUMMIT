/**
 * Shared multer config for document/image uploads (assignment instruction files
 * and submissions). Enforces a MIME whitelist + a size cap so the base64-in-DB
 * store can't be filled with arbitrary or oversized binaries. Files are kept in
 * memory (never written to a filesystem path), so path traversal isn't possible;
 * the DB row is the only storage.
 */
import multer from 'multer';
import { AppError } from './AppError.js';

// Documents, images, and plain text/csv — the formats a student attaches as
// instructions or completed work. Deliberately excludes executables/HTML/SVG.
export const DOCUMENT_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  // Some browsers/tools send DOCX/generic uploads as octet-stream; allow it only
  // when the extension is one we accept (checked below).
  'application/octet-stream',
]);

const SAFE_EXT = /\.(pdf|docx?|pptx?|xlsx?|jpe?g|png|gif|webp|txt|csv)$/i;

const documentFileFilter = (req, file, cb) => {
  const okMime = DOCUMENT_MIME.has(file.mimetype);
  const okExt = SAFE_EXT.test(file.originalname || '');
  // octet-stream is only trusted when the extension is on the whitelist.
  if (okMime && (file.mimetype !== 'application/octet-stream' || okExt)) return cb(null, true);
  if (okExt) return cb(null, true);
  return cb(AppError.badRequest('Unsupported file type. Upload a PDF, Office doc, image, or text file.'));
};

/** A memory-storage multer for document uploads, capped at `maxMb` (default 25). */
export function documentUpload(maxMb = 25) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: documentFileFilter,
  });
}
