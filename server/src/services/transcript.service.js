/**
 * Lecture transcripts per class: pasted/uploaded text, or text attached to an
 * in-app recording (whose audio is stored as a class_files row). Auto-STT is
 * pluggable (see transcription.service) and off by default, so a recording
 * stores the audio + an empty transcript the student can fill in.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { createFile, deleteFile, getFileForDownload } from './file.service.js';
import { transcribeAudio, isTranscriptionConfigured } from './transcription.service.js';
import { runText } from './learnAi.js';
import { createNote } from './note.service.js';

function toPublic(row) {
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    content: row.content,
    summary: row.summary ?? null,
    source: row.source,
    audioFileId: row.audio_file_id ?? null,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    recordedDate: row.recorded_date ?? null,
    timestamps: row.timestamps ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Whether Whisper auto-transcription is available (drives the Transcribe button). */
export { isTranscriptionConfigured };

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

/* ---- Whisper transcription + Claude summary + move-to-notes -------------- */

/**
 * Run Whisper on a transcript's linked audio and store the resulting text.
 * Requires an attached recording (audio_file_id). Propagates the service's 503
 * when auto-transcription isn't configured.
 */
export async function transcribeExisting(userId, transcriptId) {
  const t = await getOwnedTranscript(userId, transcriptId);
  if (!t.audio_file_id) {
    throw AppError.badRequest('This transcript has no audio to transcribe.');
  }
  const audio = await getFileForDownload(userId, t.audio_file_id); // { filename, mimeType, buffer }
  const text = await transcribeAudio(audio.buffer, audio.mimeType, audio.filename);
  const { rows } = await query(
    'UPDATE transcripts SET content = $2 WHERE id = $1 RETURNING *',
    [transcriptId, text],
  );
  return toPublic(rows[0]);
}

/**
 * Summarize a transcript's text with Claude and store it. Returns { summary }.
 * 503s (via runText) when ANTHROPIC_API_KEY isn't set.
 */
export async function summarizeTranscript(userId, transcriptId) {
  const t = await getOwnedTranscript(userId, transcriptId);
  const content = (t.content || '').trim();
  if (!content) {
    throw AppError.badRequest('Transcribe or add the transcript text before generating a summary.');
  }
  const summary = await runText({
    feature: 'Transcript summary',
    system:
      'You summarize lecture transcripts for a student. Produce a concise, well-structured summary in Markdown: a one-line overview, then the key points as bullets, then any action items or things to review. Be faithful to the transcript; do not invent content.',
    user: `Summarize this lecture transcript titled "${t.title}":\n\n${content.slice(0, 100_000)}`,
    maxTokens: 1500,
  });
  const clean = (summary || '').trim();
  const { rows } = await query(
    'UPDATE transcripts SET summary = $2 WHERE id = $1 RETURNING *',
    [transcriptId, clean],
  );
  return { transcript: toPublic(rows[0]), summary: clean };
}

/**
 * Create a class note from the transcript's summary (falling back to its full
 * text). Returns the created note. Does not delete the transcript.
 */
export async function moveToNotes(userId, transcriptId) {
  const t = await getOwnedTranscript(userId, transcriptId);
  const body = (t.summary || t.content || '').trim();
  if (!body) {
    throw AppError.badRequest('Nothing to move — generate a summary or add transcript text first.');
  }
  const note = await createNote(userId, t.class_id, {
    title: `${t.title} — summary`,
    content: body,
  });
  return note;
}

/**
 * Delete just the audio recording linked to a transcript (keeping the text).
 * keepAudio=true is a no-op (returns the transcript unchanged).
 */
export async function deleteTranscriptAudio(userId, transcriptId, { keepAudio = false } = {}) {
  const t = await getOwnedTranscript(userId, transcriptId);
  if (keepAudio || !t.audio_file_id) return toPublic(t);
  try {
    await deleteFile(userId, t.audio_file_id);
  } catch {
    // already gone — still detach below
  }
  const { rows } = await query(
    'UPDATE transcripts SET audio_file_id = NULL WHERE id = $1 RETURNING *',
    [transcriptId],
  );
  return toPublic(rows[0]);
}
