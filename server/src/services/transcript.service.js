/**
 * Lecture transcripts per class: pasted/uploaded text, or text attached to an
 * in-app recording (whose audio is stored as a class_files row). Auto-STT is
 * pluggable (see transcription.service) and off by default, so a recording
 * stores the audio + an empty transcript the student can fill in.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { createFile, deleteFile } from './file.service.js';
import { transcribeAudio } from './transcription.service.js';

function toPublic(row) {
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    content: row.content,
    source: row.source,
    audioFileId: row.audio_file_id ?? null,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    recordedDate: row.recorded_date ?? null,
    timestamps: row.timestamps ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOwnedTranscript(userId, transcriptId) {
  const { rows } = await query(
    `SELECT t.* FROM transcripts t
       JOIN classes c ON c.id = t.class_id
      WHERE t.id = $1 AND c.user_id = $2`,
    [transcriptId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Transcript not found');
  return rows[0];
}

/** List a class's transcripts, optionally filtered by a search term (title/content). */
export async function listTranscripts(userId, classId, q = '') {
  await getOwnedClass(userId, classId); // 404s if not owned
  const term = q.trim();
  const params = [classId];
  let where = 't.class_id = $1';
  if (term) {
    params.push(`%${term}%`);
    where += ` AND (t.title ILIKE $2 OR t.content ILIKE $2)`;
  }
  const { rows } = await query(
    `SELECT t.* FROM transcripts t
      WHERE ${where}
      ORDER BY t.recorded_date DESC NULLS LAST, t.created_at DESC`,
    params,
  );
  return rows.map(toPublic);
}

export async function getTranscript(userId, transcriptId) {
  return toPublic(await getOwnedTranscript(userId, transcriptId));
}

/** Create a transcript from pasted/uploaded text. */
export async function createTranscript(userId, classId, input) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `INSERT INTO transcripts (class_id, user_id, title, content, source, recorded_date, duration_seconds, timestamps)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, '[]'::jsonb))
     RETURNING *`,
    [
      classId,
      userId,
      input.title?.trim() || 'Lecture transcript',
      input.content ?? '',
      input.source === 'paste' ? 'paste' : 'upload',
      input.recordedDate ?? null,
      input.durationSeconds ?? null,
      input.timestamps ? JSON.stringify(input.timestamps) : null,
    ],
  );
  return toPublic(rows[0]);
}

/**
 * Create a transcript from an in-app recording: store the audio as a class_file,
 * attempt auto-transcription (no-op until a provider is wired), and create the
 * transcript record. Returns the transcript + whether text was auto-generated.
 */
export async function createFromRecording(userId, classId, file, { durationSeconds, recordedDate }) {
  await getOwnedClass(userId, classId);

  const audio = await createFile(userId, classId, file, 'audio');

  let content = '';
  let transcribed = false;
  try {
    content = await transcribeAudio(file.buffer, file.mimetype);
    transcribed = true;
  } catch (err) {
    // 503 = no STT provider configured → keep the audio, leave text empty.
    if (err?.statusCode !== 503) throw err;
  }

  const { rows } = await query(
    `INSERT INTO transcripts
       (class_id, user_id, title, content, source, audio_file_id, duration_seconds, recorded_date)
     VALUES ($1, $2, $3, $4, 'recording', $5, $6, $7)
     RETURNING *`,
    [
      classId,
      userId,
      'Recorded lecture',
      content,
      audio.id,
      durationSeconds ?? null,
      recordedDate ?? null,
    ],
  );
  return { transcript: toPublic(rows[0]), transcribed };
}

const UPDATABLE = { title: 'title', content: 'content', recordedDate: 'recorded_date' };

export async function updateTranscript(userId, transcriptId, input) {
  await getOwnedTranscript(userId, transcriptId);
  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (field in input) {
      sets.push(`${column} = $${i++}`);
      values.push(input[field] ?? null);
    }
  }
  if (sets.length > 0) {
    values.push(transcriptId);
    await query(`UPDATE transcripts SET ${sets.join(', ')} WHERE id = $${i}`, values);
  }
  return getTranscript(userId, transcriptId);
}

/** Delete a transcript (and its linked audio file, if any). */
export async function deleteTranscript(userId, transcriptId) {
  const t = await getOwnedTranscript(userId, transcriptId);
  await query('DELETE FROM transcripts WHERE id = $1', [transcriptId]);
  if (t.audio_file_id) {
    try {
      await deleteFile(userId, t.audio_file_id);
    } catch {
      // audio already gone — ignore
    }
  }
}
