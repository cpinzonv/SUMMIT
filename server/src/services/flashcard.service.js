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
    // Card type + type-specific payloads (cloze/image/math).
    cardType: row.card_type || 'basic',
    clozeParts: row.cloze_parts ?? null,
    imageUrl: row.image_url ?? null,
    occlusionShapes: row.occlusion_shapes ?? null,
    latexContent: row.latex_content ?? null,
    sourceType: row.source_type ?? null,
    sourceId: row.source_id ?? null,
    deckId: row.deck_id ?? null,
    generatedBy: row.generated_by,
    userEdited: row.user_edited,
    tags: row.tags ?? [],
    difficulty: row.difficulty,
    // Study-action state: suspended cards are hidden from study; buried cards
    // return once bury_until passes.
    isSuspended: row.is_suspended ?? false,
    buryUntil: row.bury_until ?? null,
    // Classic SM-2 schedule (source of truth for due/new).
    easeFactor: row.ease_factor != null ? Number(row.ease_factor) : 2.5,
    interval: row.sm2_interval ?? 0,
    repetitions: row.repetitions ?? 0,
    nextReviewDate: row.next_review_date ?? null,
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

/* ---- Decks ---------------------------------------------------------------- */

/** A class's decks with their (non-archived-agnostic) card counts, newest first. */
export async function listClassDecks(userId, classId) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `SELECT d.id, d.name, d.description, d.source_note_id, d.created_at,
            count(f.id)::int AS card_count
       FROM decks d
       LEFT JOIN flashcards f ON f.deck_id = d.id
      WHERE d.class_id = $1 AND d.user_id = $2
      GROUP BY d.id
      ORDER BY d.created_at DESC`,
    [classId, userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    sourceNoteId: r.source_note_id,
    cardCount: r.card_count,
    createdAt: r.created_at,
  }));
}

/** Cards in a deck (owner-scoped via the deck), with mastery + next-review. */
export async function listDeckCards(userId, deckId) {
  const { rows: deckRows } = await query('SELECT id FROM decks WHERE id = $1 AND user_id = $2', [deckId, userId]);
  if (!deckRows[0]) throw AppError.notFound('Deck not found');
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
      WHERE f.deck_id = $1 AND f.user_id = $2
      ORDER BY f.created_at DESC`,
    [deckId, userId],
  );
  return rows.map(toPublicCard);
}

/** Reuse the deck for a note (by source_note_id) or create it. Returns the deck id. */
async function getOrCreateDeckForNote(userId, classId, note, db = { query }) {
  const { rows } = await db.query(
    `INSERT INTO decks (class_id, user_id, name, source_note_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (class_id, source_note_id) WHERE source_note_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [classId, userId, note.title?.trim() || 'Untitled note', note.id],
  );
  return rows[0].id;
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

/** Manually author a card (any of the 4 types). */
export async function createCard(userId, classId, input) {
  await getOwnedClass(userId, classId);
  const { question, answer, explanation, tags, difficulty, sourceType, sourceId } = input;
  const cardType = input.cardType || 'basic';
  const { rows } = await query(
    `INSERT INTO flashcards
       (class_id, user_id, question, answer, explanation, tags, difficulty,
        source_type, source_id, generated_by,
        card_type, cloze_parts, image_url, occlusion_shapes, latex_content)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::card_difficulty,'medium'),$8::flashcard_source,$9,'user',
        $10,$11::jsonb,$12,$13::jsonb,$14)
     RETURNING *`,
    [
      classId,
      userId,
      question,
      // Cloze/image cards may have no separate answer.
      answer ?? (cardType === 'cloze' || cardType === 'image' ? '' : answer),
      explanation ?? null,
      tags ?? [],
      difficulty ?? null,
      sourceType ?? null,
      sourceId ?? null,
      cardType,
      input.clozeParts ? JSON.stringify(input.clozeParts) : null,
      input.imageUrl ?? null,
      input.occlusionShapes ? JSON.stringify(input.occlusionShapes) : null,
      input.latexContent ?? null,
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

/** Bury a card: hide it from study until `bury_until` (default: +1 day). */
export async function buryCard(userId, cardId) {
  const { rows } = await query(
    `UPDATE flashcards
        SET bury_until = now() + interval '1 day'
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [cardId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Flashcard not found');
  return toPublicCard(rows[0]);
}

/** Suspend a card: hide it from all study sessions until unsuspended. */
export async function suspendCard(userId, cardId) {
  const { rows } = await query(
    `UPDATE flashcards
        SET is_suspended = true
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [cardId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Flashcard not found');
  return toPublicCard(rows[0]);
}

// ---- Claude generation -----------------------------------------------------

const MAX_CONTEXT_CHARS = 60000;

// Multi-format generation. Cloze cards put {{c1::hidden}} markers in `question`
// (answer may be empty); math cards use $$LaTeX$$; image cards carry a `prompt`
// describing what to occlude (the user supplies the image later).
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
          cardType: { type: 'string', enum: ['basic', 'cloze', 'math', 'image'] },
          question: { type: 'string', description: 'Q&A question, cloze sentence with {{c1::..}}, $$LaTeX$$ problem, or image prompt' },
          answer: { type: ['string', 'null'], description: 'Answer (basic/math); null for cloze/image' },
          explanation: { type: ['string', 'null'] },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['cardType', 'question', 'answer', 'explanation', 'difficulty', 'tags'],
      },
    },
  },
  required: ['cards'],
};

const CLOZE_RE = /\{\{c\d+::.+?\}\}/;
const LATEX_RE = /\$\$|\\[a-zA-Z]+|\\\(|\\\[/;

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
/**
 * Call Claude for one context block and insert the resulting cards, optionally
 * filed under a deck and attributed to a source note. Returns the created cards.
 */
async function generateIntoDeck(userId, classId, cls, context, count, { deckId = null, sourceId = null, sourceType = null } = {}) {
  const n = Math.min(Math.max(count, 1), 100);
  const system =
    `You are an expert flashcard author for a student's "${cls.name}" class. Using ONLY the ` +
    `material below, write up to ${n} high-quality cards in a MIX of formats:\n` +
    `- basic: a clear question + concise answer.\n` +
    `- cloze: a full sentence with 1-3 {{c1::hidden}} {{c2::..}} deletions (answer null).\n` +
    `- math: a $$LaTeX$$ problem in question and $$LaTeX$$ solution in answer (for STEM topics).\n` +
    `- image: only the "prompt" describing a diagram to occlude (answer null) — use sparingly.\n` +
    `Favor cloze + math for technical material. Every card needs 1-3 lowercase tags and a difficulty. ` +
    `Do not invent facts. Material:\n"""\n${context}\n"""`;

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: cardsSchema } },
      system,
      messages: [{ role: 'user', content: `Generate the cards now (max ${n}), mixing formats appropriately.` }],
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

  const created = [];
  for (const c of cards) {
    const q = c.question?.trim();
    if (!q) continue;
    // Normalize/validate the card type against its payload.
    let type = ['basic', 'cloze', 'math', 'image'].includes(c.cardType) ? c.cardType : 'basic';
    if (type === 'cloze' && !CLOZE_RE.test(q)) type = 'basic'; // missing markers → treat as basic
    if (type === 'math' && !LATEX_RE.test(`${q}${c.answer || ''}`)) type = 'basic';
    const answer = type === 'cloze' || type === 'image' ? (c.answer || '') : (c.answer?.trim() || '');
    if (type === 'basic' && !answer) continue; // basic needs an answer
    const latex = type === 'math' ? (c.answer || q) : null;

    const { rows } = await query(
      `INSERT INTO flashcards
         (class_id, user_id, question, answer, explanation, tags, difficulty,
          source_type, source_id, deck_id, generated_by, card_type, latex_content)
       VALUES ($1,$2,$3,$4,$5,$6,$7::card_difficulty,$8::flashcard_source,$9,$10,'claude',$11,$12)
       RETURNING *`,
      [
        classId, userId, q, answer, c.explanation || null,
        Array.isArray(c.tags) ? c.tags.slice(0, 8) : [],
        ['easy', 'medium', 'hard'].includes(c.difficulty) ? c.difficulty : 'medium',
        sourceType, sourceId, deckId, type, latex,
      ],
    );
    created.push(toPublicCard(rows[0]));
  }
  return created;
}

/**
 * Generate flashcards for a class. When `notes` (note IDs) are provided, cards
 * are generated per note and filed under a deck named after each note;
 * otherwise a single combined generation runs (no deck).
 */
export async function generateCards(userId, classId, { count = 15, sourceType = null, notes = null } = {}) {
  const cls = await getOwnedClass(userId, classId);
  const noteIds = Array.isArray(notes) ? notes.filter(Boolean) : [];

  if (noteIds.length) {
    const { rows: noteRows } = await query(
      `SELECT id, title, content FROM notes
        WHERE class_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
      [classId, noteIds],
    );
    const usable = noteRows.filter((nte) => htmlToText(nte.content));
    if (!usable.length) {
      throw new AppError(400, 'The selected notes have no text to generate from. Add content, then generate.', { code: 'no_material' });
    }
    const per = Math.max(1, Math.round(count / usable.length));
    const all = [];
    for (const note of usable) {
      const deckId = await getOrCreateDeckForNote(userId, classId, note);
      const context = `## Note: ${note.title}\n${htmlToText(note.content)}`.slice(0, MAX_CONTEXT_CHARS);
      const created = await generateIntoDeck(userId, classId, cls, context, per, {
        deckId, sourceId: note.id, sourceType: 'note',
      });
      all.push(...created);
    }
    return all;
  }

  const context = await gatherContext(userId, classId, sourceType);
  if (!context) {
    throw new AppError(400, 'Add notes or transcripts to this class first, then generate cards.', { code: 'no_material' });
  }
  return generateIntoDeck(userId, classId, cls, context, count, { sourceType });
}
