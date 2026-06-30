/**
 * Flashcards — CRUD plus Claude-powered generation from a class's notes and
 * transcripts. Generation reuses the ANTHROPIC_API_KEY the syllabus/chatbot
 * features use and returns 503 when unset (manual card creation always works).
 *
 * Generation currently draws on notes + transcripts (their text is readily
 * available); file-derived generation is a future seam, mirroring how the richer
 * Learn formats (quizzes/guides/maps/podcasts) are deferred.
 */
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';

let client;
function getClient() {
  if (!env.anthropicApiKey) {
    throw new AppError(
      503,
      'Flashcard generation is not configured. Set ANTHROPIC_API_KEY in the server environment.',
    );
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

/** Strip HTML tags / collapse whitespace so note HTML reads as plain text. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** API shape. Effective Q/A prefer the user's edits over the generated text. */
export function toPublicCard(row) {
  return {
    id: row.id,
    classId: row.class_id,
    question: row.custom_question || row.question,
    answer: row.custom_answer || row.answer,
    explanation: row.explanation ?? null,
    // Originals kept so the editor can show "reset to generated".
    originalQuestion: row.question,
    originalAnswer: row.answer,
    sourceType: row.source_type ?? null,
    sourceId: row.source_id ?? null,
    generatedBy: row.generated_by,
    userEdited: row.user_edited,
    tags: row.tags ?? [],
    difficulty: row.difficulty,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Present when joined with mastery_levels (list view).
    ...(row.mastery_status !== undefined
      ? {
          mastery: {
            status: row.mastery_status ?? 'new',
            masteryPercent: row.mastery_percent ?? 0,
            totalReviews: row.total_reviews ?? 0,
            nextReviewAt: row.next_review_at ?? null,
          },
        }
      : {}),
  };
}

/** Fetch a card scoped to its owner, or 404. */
export async function getOwnedCard(userId, cardId) {
  const { rows } = await query('SELECT * FROM flashcards WHERE id = $1 AND user_id = $2', [
    cardId,
    userId,
  ]);
  if (!rows[0]) throw AppError.notFound('Flashcard not found');
  return rows[0];
}

/** List a class's cards (newest first), with mastery state + next-review joined. */
export async function listClassCards(userId, classId, { tag, difficulty } = {}) {
  await getOwnedClass(userId, classId);
  const params = [classId, userId];
  let where = 'f.class_id = $1 AND f.user_id = $2';
  if (difficulty) {
    params.push(difficulty);
    where += ` AND f.difficulty = $${params.length}::card_difficulty`;
  }
  if (tag) {
    params.push(tag);
    where += ` AND $${params.length} = ANY(f.tags)`;
  }
  const { rows } = await query(
    `SELECT f.*,
            m.status AS mastery_status, m.mastery_percent, m.total_reviews,
            lr.next_review_at
       FROM flashcards f
       LEFT JOIN mastery_levels m ON m.card_id = f.id AND m.user_id = f.user_id
       LEFT JOIN LATERAL (
         SELECT next_review_at FROM card_reviews r
          WHERE r.card_id = f.id ORDER BY reviewed_at DESC LIMIT 1
       ) lr ON true
      WHERE ${where}
      ORDER BY f.created_at DESC`,
    params,
  );
  return rows.map(toPublicCard);
}

/** Manually author a card. */
export async function createCard(userId, classId, input) {
  await getOwnedClass(userId, classId);
  const { question, answer, explanation, tags, difficulty, sourceType, sourceId } = input;
  const { rows } = await query(
    `INSERT INTO flashcards
       (class_id, user_id, question, answer, explanation, tags, difficulty,
        source_type, source_id, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::card_difficulty,'medium'),$8::flashcard_source,$9,'user')
     RETURNING *`,
    [
      classId,
      userId,
      question,
      answer,
      explanation ?? null,
      tags ?? [],
      difficulty ?? null,
      sourceType ?? null,
      sourceId ?? null,
    ],
  );
  return toPublicCard(rows[0]);
}

/** Edit a card. Editing Q/A stores into custom_* and flips user_edited. */
export async function updateCard(userId, cardId, input) {
  await getOwnedCard(userId, cardId);
  const sets = [];
  const params = [];
  const set = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (input.question !== undefined) {
    set('custom_question', input.question);
    set('user_edited', true);
  }
  if (input.answer !== undefined) {
    set('custom_answer', input.answer);
    set('user_edited', true);
  }
  if (input.explanation !== undefined) set('explanation', input.explanation);
  if (input.tags !== undefined) set('tags', input.tags);
  if (input.difficulty !== undefined) {
    // Enum column: cast the bound text param to the enum type.
    params.push(input.difficulty);
    sets.push(`difficulty = $${params.length}::card_difficulty`);
  }

  if (!sets.length) throw AppError.badRequest('Nothing to update');
  params.push(cardId, userId);
  const { rows } = await query(
    `UPDATE flashcards SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND user_id = $${params.length}
      RETURNING *`,
    params,
  );
  return toPublicCard(rows[0]);
}

export async function deleteCard(userId, cardId) {
  const { rowCount } = await query('DELETE FROM flashcards WHERE id = $1 AND user_id = $2', [
    cardId,
    userId,
  ]);
  if (!rowCount) throw AppError.notFound('Flashcard not found');
}

// ---- Claude generation -----------------------------------------------------

const MAX_CONTEXT_CHARS = 60000;

const cardsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string', description: 'A clear, single-concept question' },
          answer: { type: 'string', description: 'A concise, correct answer' },
          explanation: {
            type: ['string', 'null'],
            description: 'Optional 1-2 sentence deeper explanation, or null',
          },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short topic tags, e.g. ["vocabulary"], ["formula"]',
          },
        },
        required: ['question', 'answer', 'explanation', 'difficulty', 'tags'],
      },
    },
  },
  required: ['cards'],
};

/** Collect a class's study material text for generation, by source type. */
async function gatherContext(userId, classId, sourceType) {
  const blocks = [];

  if (!sourceType || sourceType === 'note') {
    const { rows } = await query(
      `SELECT title, content FROM notes
        WHERE class_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC`,
      [classId],
    );
    for (const n of rows) {
      const text = htmlToText(n.content);
      if (text) blocks.push(`## Note: ${n.title}\n${text}`);
    }
  }
  if (!sourceType || sourceType === 'transcript') {
    const { rows } = await query(
      `SELECT title, content FROM transcripts
        WHERE class_id = $1 ORDER BY created_at DESC`,
      [classId],
    );
    for (const t of rows) {
      if (t.content?.trim()) blocks.push(`## Transcript: ${t.title}\n${t.content.trim()}`);
    }
  }

  let context = '';
  for (const b of blocks) {
    if (context.length + b.length > MAX_CONTEXT_CHARS) break;
    context += `\n\n${b}`;
  }
  return context.trim();
}

/**
 * Generate flashcards from a class's material and persist them.
 * @returns {Promise<object[]>} the created cards (public shape)
 */
export async function generateCards(userId, classId, { count = 15, sourceType = null } = {}) {
  const cls = await getOwnedClass(userId, classId);
  const context = await gatherContext(userId, classId, sourceType);
  if (!context) {
    throw new AppError(400, 'Add notes or transcripts to this class first, then generate cards.', {
      code: 'no_material',
    });
  }

  const n = Math.min(Math.max(count, 1), 40);
  const system =
    `You are creating study flashcards for a student's "${cls.name}" class. ` +
    `Using ONLY the material below, write up to ${n} high-quality flashcards that test ` +
    `understanding of the most important concepts, definitions, and relationships. ` +
    `Prefer atomic, single-idea cards. Do not invent facts not present in the material.\n\n` +
    `Material:\n"""\n${context}\n"""`;

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: cardsSchema } },
      system,
      messages: [{ role: 'user', content: `Generate the flashcards now (max ${n}).` }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    throw new AppError(502, `Flashcard generation failed: ${err?.message || 'unknown error'}`);
  }
  if (message.stop_reason === 'refusal') {
    throw AppError.badRequest('The model declined to generate cards from this material.');
  }

  let parsed;
  try {
    parsed = JSON.parse(message.content.find((b) => b.type === 'text')?.text ?? '{}');
  } catch {
    throw new AppError(502, 'Could not parse the generated cards.');
  }
  const cards = Array.isArray(parsed.cards) ? parsed.cards.slice(0, n) : [];
  if (!cards.length) throw new AppError(502, 'No cards were generated. Try again.');

  // Bulk insert.
  const created = [];
  for (const c of cards) {
    if (!c.question?.trim() || !c.answer?.trim()) continue;
    const { rows } = await query(
      `INSERT INTO flashcards
         (class_id, user_id, question, answer, explanation, tags, difficulty,
          source_type, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::card_difficulty,$8::flashcard_source,'claude')
       RETURNING *`,
      [
        classId,
        userId,
        c.question.trim(),
        c.answer.trim(),
        c.explanation || null,
        Array.isArray(c.tags) ? c.tags.slice(0, 8) : [],
        ['easy', 'medium', 'hard'].includes(c.difficulty) ? c.difficulty : 'medium',
        sourceType,
      ],
    );
    created.push(toPublicCard(rows[0]));
  }
  return created;
}
