import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';

/**
 * Notes are now rich text (HTML from the WYSIWYG editor). The editor only emits
 * a safe subset, but this strips dangerous markup defensively in case content
 * arrives by another path: script/style/iframe blocks, inline event handlers,
 * and javascript: URLs.
 */
function sanitizeNoteHtml(html) {
  if (!html) return html;
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

function toPublicNote(row) {
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    content: row.content,
    className: row.class_name, // present on search results
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fetch a note scoped to its owner (via the parent class). 404s otherwise. */
async function getOwnedNote(userId, noteId) {
  const { rows } = await query(
    `SELECT n.* FROM notes n
     JOIN classes c ON c.id = n.class_id
     WHERE n.id = $1 AND c.user_id = $2`,
    [noteId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Note not found');
  return rows[0];
}

/** List a class's notes, newest first. Optional case-insensitive search. */
export async function listNotes(userId, classId, q, { archived = false } = {}) {
  await getOwnedClass(userId, classId);
  const params = [classId];
  // Default view = active notes; `archived` flips to the archived view.
  let where = `class_id = $1 AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'}`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (title ILIKE $2 OR content ILIKE $2)`;
  }
  const { rows } = await query(
    `SELECT * FROM notes WHERE ${where} ORDER BY updated_at DESC`,
    params,
  );
  return rows.map(toPublicNote);
}

export async function createNote(userId, classId, { title, content }) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `INSERT INTO notes (class_id, user_id, title, content)
     VALUES ($1, $2, COALESCE(NULLIF($3, ''), 'Untitled note'), COALESCE($4, ''))
     RETURNING *`,
    [classId, userId, title ?? null, sanitizeNoteHtml(content) ?? null],
  );
  return toPublicNote(rows[0]);
}

export async function updateNote(userId, noteId, input) {
  await getOwnedNote(userId, noteId);
  const sets = [];
  const values = [];
  let i = 1;
  if ('title' in input) {
    sets.push(`title = $${i++}`);
    values.push(input.title);
  }
  if ('content' in input) {
    sets.push(`content = $${i++}`);
    values.push(sanitizeNoteHtml(input.content));
  }
  if ('archived' in input) {
    // Boolean toggle → stamp or clear archived_at (no placeholder needed).
    sets.push(`archived_at = ${input.archived ? 'now()' : 'NULL'}`);
  }
  if (sets.length === 0) return getOwnedNote(userId, noteId).then(toPublicNote);
  values.push(noteId);
  const { rows } = await query(
    `UPDATE notes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  return toPublicNote(rows[0]);
}

export async function deleteNote(userId, noteId) {
  await getOwnedNote(userId, noteId);
  await query('DELETE FROM notes WHERE id = $1', [noteId]);
}

/** Search across all of the user's notes (any class). */
export async function searchNotes(userId, q) {
  const { rows } = await query(
    `SELECT n.*, c.name AS class_name
     FROM notes n JOIN classes c ON c.id = n.class_id
     WHERE c.user_id = $1
       AND ($2 = '' OR n.title ILIKE $3 OR n.content ILIKE $3)
     ORDER BY n.updated_at DESC
     LIMIT 100`,
    [userId, q ?? '', `%${q ?? ''}%`],
  );
  return rows.map(toPublicNote);
}
