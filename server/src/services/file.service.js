/**
 * Per-class file storage. Files are kept inline (base64) in class_files for the
 * MVP — no object storage needed. List/metadata queries never select the `data`
 * column; only the download path does.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';

// 'audio' backs lecture recordings (hidden from the document sections); the
// rest are the document categories shown in the Files tab.
export const FILE_CATEGORIES = ['pdf', 'slides', 'textbook', 'formula_sheet', 'audio', 'other'];

function toPublicFile(row) {
  return {
    id: row.id,
    classId: row.class_id,
    filename: row.filename,
    mimeType: row.mime_type,
    category: row.category,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at,
  };
}

/** List a class's files (metadata only — no bytes). */
export async function listFiles(userId, classId) {
  await getOwnedClass(userId, classId); // 404s if not owned
  const { rows } = await query(
    `SELECT id, class_id, filename, mime_type, category, size_bytes, uploaded_at
       FROM class_files WHERE class_id = $1 ORDER BY uploaded_at DESC`,
    [classId],
  );
  return rows.map(toPublicFile);
}

/** Store an uploaded file (multer memory buffer) against a class. */
export async function createFile(userId, classId, { buffer, originalname, mimetype }, category) {
  await getOwnedClass(userId, classId);
  const cat = FILE_CATEGORIES.includes(category) ? category : 'other';
  const { rows } = await query(
    `INSERT INTO class_files (class_id, user_id, filename, mime_type, category, size_bytes, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, class_id, filename, mime_type, category, size_bytes, uploaded_at`,
    [classId, userId, originalname, mimetype ?? null, cat, buffer.length, buffer.toString('base64')],
  );
  return toPublicFile(rows[0]);
}

/** Fetch one file WITH its bytes, scoped to the owner (for download/preview). */
export async function getFileForDownload(userId, fileId) {
  const { rows } = await query(
    `SELECT f.* FROM class_files f
       JOIN classes c ON c.id = f.class_id
      WHERE f.id = $1 AND c.user_id = $2`,
    [fileId, userId],
  );
  if (!rows[0]) throw AppError.notFound('File not found');
  const f = rows[0];
  return { filename: f.filename, mimeType: f.mime_type, buffer: Buffer.from(f.data, 'base64') };
}

/** Delete a file the user owns. */
export async function deleteFile(userId, fileId) {
  const { rowCount } = await query(
    `DELETE FROM class_files f USING classes c
      WHERE f.id = $1 AND f.class_id = c.id AND c.user_id = $2`,
    [fileId, userId],
  );
  if (rowCount === 0) throw AppError.notFound('File not found');
}
