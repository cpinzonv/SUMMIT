/**
 * Study guides — Claude-generated structured markdown summaries of a class's
 * material. Stored as markdown text; the client renders it (with a TOC from the
 * ## headers) and can mark a guide read / bookmarked.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { gatherClassContext } from './learnSource.js';
import { runText } from './learnAi.js';

const PROMPT = `Create a study guide from the class material below. Use this exact markdown structure:

## Overview
A 1-2 sentence summary.

## Key Concepts
- **Term** — definition (one bullet per concept).

## Important Formulas
List any formulas (omit this section if none apply).

## Common Mistakes
- Things students often get wrong.

## Practice Questions
3-5 conceptual questions (no answers).

Return ONLY the markdown. Use only the material provided; do not invent facts.`;

function toPublicGuide(r, { withContent = false } = {}) {
  return {
    id: r.id,
    classId: r.class_id,
    title: r.title,
    ...(withContent ? { content: r.content } : {}),
    generatedFrom: r.generated_from ?? [],
    bookmarked: r.bookmarked,
    readAt: r.read_at ?? null,
    generatedAt: r.generated_at,
  };
}

/** Pull a title from the first heading, else fall back to the class name. */
function deriveTitle(markdown, className) {
  const h = markdown.match(/^#{1,3}\s+(.+)$/m);
  const overview = markdown.match(/##\s*Overview\s*\n+([^\n#]+)/i);
  if (overview) return `${className} — Study Guide`;
  return h ? h[1].trim() : `${className} — Study Guide`;
}

export async function generateStudyGuide(userId, classId, { sourceType = null } = {}) {
  const cls = await getOwnedClass(userId, classId);
  const { text, sources } = await gatherClassContext(classId, sourceType);

  const content = await runText({
    feature: 'Study guide generation',
    system: `You are an expert tutor for a student's "${cls.name}" class.\n${PROMPT}\n\nMaterial:\n"""\n${text}\n"""`,
    user: 'Write the study guide now.',
  });
  if (!content.trim()) throw new AppError(502, 'The study guide came back empty. Try again.');

  const title = deriveTitle(content, cls.name);
  const { rows } = await query(
    `INSERT INTO study_guides (class_id, user_id, title, content, generated_from)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [classId, userId, title, content.trim(), sources],
  );
  return toPublicGuide(rows[0], { withContent: true });
}

export async function listClassGuides(userId, classId) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `SELECT * FROM study_guides WHERE class_id = $1 AND user_id = $2 ORDER BY generated_at DESC`,
    [classId, userId],
  );
  return rows.map((r) => toPublicGuide(r));
}

export async function getGuide(userId, guideId) {
  const { rows } = await query('SELECT * FROM study_guides WHERE id = $1 AND user_id = $2', [guideId, userId]);
  if (!rows[0]) throw AppError.notFound('Study guide not found');
  return toPublicGuide(rows[0], { withContent: true });
}

/** Delete a study guide the user owns. */
export async function deleteGuide(userId, guideId) {
  const { rowCount } = await query('DELETE FROM study_guides WHERE id = $1 AND user_id = $2', [guideId, userId]);
  if (!rowCount) throw AppError.notFound('Study guide not found');
}

export async function markGuide(userId, guideId, { completed, bookmarked }) {
  const sets = [];
  const params = [];
  if (completed !== undefined) {
    params.push(completed ? new Date() : null);
    sets.push(`read_at = $${params.length}`);
  }
  if (bookmarked !== undefined) {
    params.push(bookmarked);
    sets.push(`bookmarked = $${params.length}`);
  }
  if (!sets.length) throw AppError.badRequest('Nothing to update');
  params.push(guideId, userId);
  const { rows } = await query(
    `UPDATE study_guides SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows[0]) throw AppError.notFound('Study guide not found');
  return toPublicGuide(rows[0], { withContent: true });
}
