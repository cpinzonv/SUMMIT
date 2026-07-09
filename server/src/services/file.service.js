/**
 * Per-class file storage. Files are kept inline (base64) in class_files for the
 * MVP — no object storage needed. List/metadata queries never select the `data`
 * column; only the download path does.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';

// 'audio' backs lecture recordings, 'submission' backs assignment submissions,
// and 'assignment_instructions' backs uploaded instruction docs on an assignment
// (all hidden from the class document sections); the rest are Files-tab categories.
export const FILE_CATEGORIES = ['pdf', 'slides', 'textbook', 'formula_sheet', 'audio', 'submission', 'assignment_instructions', 'other'];

function toPublicFile(row) {
  return {
    id: row.id,
    classId: row.class_id,
    assignmentId: row.assignment_id ?? null,
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
       FROM class_files
      WHERE class_id = $1 AND category <> 'submission'
      ORDER BY uploaded_at DESC`,
    [classId],
  );
  return rows.map(toPublicFile);
}

/**
 * Store an uploaded file (multer memory buffer) against a class, optionally
 * linked to a specific assignment (instruction docs + submission files).
 */
export async function createFile(userId, classId, { buffer, originalname, mimetype }, category, assignmentId = null) {
  await getOwnedClass(userId, classId);
  const cat = FILE_CATEGORIES.includes(category) ? category : 'other';
  const { rows } = await query(
    `INSERT INTO class_files (class_id, user_id, assignment_id, filename, mime_type, category, size_bytes, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, class_id, assignment_id, filename, mime_type, category, size_bytes, uploaded_at`,
    [classId, userId, assignmentId, originalname, mimetype ?? null, cat, buffer.length, buffer.toString('base64')],
  );
  return toPublicFile(rows[0]);
}

/** Rename a file the user owns. */
export async function renameFile(userId, fileId, filename) {
  const { rows } = await query(
    `UPDATE class_files f SET filename = $1
       FROM classes c
      WHERE f.id = $2 AND f.class_id = c.id AND c.user_id = $3
      RETURNING f.id, f.class_id, f.assignment_id, f.filename, f.mime_type, f.category, f.size_bytes, f.uploaded_at`,
    [filename, fileId, userId],
  );
  if (!rows[0]) throw AppError.notFound('File not found');
  return toPublicFile(rows[0]);
}

/** List the files attached to one assignment, optionally filtered by category. */
export async function listAssignmentFiles(userId, assignmentId, category = null) {
  const { rows } = await query(
    `SELECT f.id, f.class_id, f.assignment_id, f.filename, f.mime_type, f.category, f.size_bytes, f.uploaded_at
       FROM class_files f
       JOIN classes c ON c.id = f.class_id
      WHERE f.assignment_id = $1 AND c.user_id = $2
        AND ($3::text IS NULL OR f.category = $3)
      ORDER BY f.uploaded_at DESC`,
    [assignmentId, userId, category],
  );
  return rows.map(toPublicFile);
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
