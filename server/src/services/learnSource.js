/**
 * Gather a class's study material (notes + transcripts) as plain text for the
 * Learn-tab generators. Shared by quizzes / study guides / mind maps / podcasts.
 * File-derived material is a future seam (binary files need per-type extraction),
 * matching the flashcard generator's scope.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

const MAX_CONTEXT_CHARS = 60000;

/** Strip HTML tags so note HTML reads as plain text. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {Promise<{ text:string, sources:string[] }>} concatenated material
 *   (capped) and which source kinds contributed (for `generated_from`).
 */
export async function gatherClassContext(classId, sourceType = null) {
  const blocks = [];
  const sources = new Set();

  if (!sourceType || sourceType === 'note') {
    const { rows } = await query(
      `SELECT title, content FROM notes WHERE class_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC`,
      [classId],
    );
    for (const n of rows) {
      const t = htmlToText(n.content);
      if (t) {
        blocks.push(`## Note: ${n.title}\n${t}`);
        sources.add('notes');
      }
    }
  }
  if (!sourceType || sourceType === 'transcript') {
    const { rows } = await query(
      `SELECT title, content FROM transcripts WHERE class_id = $1 ORDER BY created_at DESC`,
      [classId],
    );
    for (const tr of rows) {
      if (tr.content?.trim()) {
        blocks.push(`## Transcript: ${tr.title}\n${tr.content.trim()}`);
        sources.add('transcripts');
      }
    }
  }

  let text = '';
  for (const b of blocks) {
    if (text.length + b.length > MAX_CONTEXT_CHARS) break;
    text += `\n\n${b}`;
  }
  text = text.trim();
  if (!text) {
    throw new AppError(400, 'Add notes or transcripts to this class first, then generate.', {
      code: 'no_material',
    });
  }
  return { text, sources: [...sources] };
}
