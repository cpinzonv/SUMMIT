import Anthropic from '@anthropic-ai/sdk';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { fileContentBlocks } from './syllabus.service.js';

/**
 * Degree Requirements — Stage R1 (Planner). Extracts a degree-requirements sheet
 * (pasted text, photo, or PDF) into a structured checklist, and persists it as
 * one degree program per user (categories + their course options). Makes the
 * 4-year roadmap requirements-aware.
 *
 * Reuses the same extraction plumbing as syllabus + the Semester Schedule
 * Builder: a server-side Claude call (never from the client) with a strict
 * JSON-schema structured output, `fileContentBlocks` for image/PDF/DOCX, and
 * defensive parsing. NO prereq/offerings enforcement here (that's R2).
 */

let client;
function getClient() {
  if (!env.anthropicApiKey) {
    throw new AppError(503, 'Requirements extraction is not configured. Set ANTHROPIC_API_KEY in the server environment.');
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

const TERMS = ['Fall', 'Spring', 'Summer'];

// Structured-output schema. Every field nullable so the model extracts only what
// the sheet shows and never invents. offered_terms is array-or-null (null =
// "sheet didn't say"); prereq_groups is an array of groups (see prompt).
const programSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    program: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: ['string', 'null'], description: 'e.g. "B.S. Computer Science"' },
        total_credits: { type: ['integer', 'null'] },
      },
      required: ['name', 'total_credits'],
    },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: ['string', 'null'] },
          credits_required: { type: ['integer', 'null'] },
          notes: { type: ['string', 'null'], description: 'qualifier text, e.g. "9 credits from any 300-level HIST"' },
          courses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                course_code: { type: ['string', 'null'] },
                course_title: { type: ['string', 'null'] },
                credits: { type: ['integer', 'null'] },
                offered_terms: {
                  type: ['array', 'null'],
                  items: { type: 'string', enum: TERMS },
                  description: 'terms offered, or null when the sheet does not say',
                },
                prereq_groups: {
                  type: 'array',
                  items: { type: 'array', items: { type: 'string' } },
                  description: 'array of groups; ANY member of a group satisfies it, ALL groups required',
                },
              },
              required: ['course_code', 'course_title', 'credits', 'offered_terms', 'prereq_groups'],
            },
          },
        },
        required: ['name', 'credits_required', 'notes', 'courses'],
      },
    },
  },
  required: ['program', 'categories'],
};

export const EXTRACTION_PROMPT = `You are extracting a college DEGREE-REQUIREMENTS sheet (pasted text, a photo, or a PDF) into a structured checklist.

Extract:
- program: { name (e.g. "B.S. Computer Science"), total_credits (the whole degree's credit total, integer) }.
- categories: the requirement groups on the sheet (e.g. "Core CS", "Mathematics", "General Education", "Free Electives"). For each: { name, credits_required (credits this category needs), notes (any qualifier text), courses }.
- courses within a category: for each SPECIFIC course the sheet lists under it: { course_code (e.g. "MATH 162"), course_title, credits, offered_terms, prereq_groups }.

Rules:
- offered_terms: an array containing ONLY the terms the sheet states the course is offered, from ["Fall","Spring","Summer"]. Use null when the sheet does NOT state offered terms — do NOT guess.
- prereq_groups models prerequisites as an "or"-of-ANDs: an array of GROUPS, each group an array of course codes/tokens. Satisfying ANY one member of a group satisfies that group; ALL groups must be satisfied. Examples: "MATH 161 or placement" then "CHEM 101" → [["MATH 161","PLACEMENT"],["CHEM 101"]]. A lone prereq "MATH 161" → [["MATH 161"]]. "no prerequisites" → [].
- A category described only by a rule with no explicit course list (e.g. "9 credits from any 300-level HIST") gets its credits_required and notes set and an EMPTY courses array.
- Use null for any field the sheet does not show. NEVER invent course codes, credits, terms, or prereqs. Ignore page chrome, legends, and footnotes that are not requirements.

Return ONLY the JSON object.`;

/* ------------------------------------------------- normalizing / defensive */

const str = (v) => {
  const t = v == null ? null : String(v).trim();
  return t ? t.slice(0, 500) : null;
};
/** Coerce to a non-negative integer, or null. */
const toInt = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};
/** Keep only the Fall/Spring/Summer the sheet listed; null stays null (unknown). */
function cleanTerms(t) {
  if (t == null || !Array.isArray(t)) return t == null ? null : [];
  const set = new Set(
    t.map((x) => TERMS.find((T) => T.toLowerCase() === String(x).trim().toLowerCase())).filter(Boolean),
  );
  return TERMS.filter((T) => set.has(T));
}
/** Array of non-empty groups, each an array of non-empty token strings. */
function cleanPrereqGroups(g) {
  if (!Array.isArray(g)) return [];
  return g
    .map((grp) => (Array.isArray(grp) ? grp.map((x) => str(x)).filter(Boolean) : []))
    .filter((grp) => grp.length);
}

const courseHasContent = (c) => c.courseCode || c.courseTitle || c.credits != null;

function normalizeCourse(raw = {}) {
  const credits = toInt(raw.credits);
  const issues = [];
  if (raw.credits != null && raw.credits !== '' && credits == null) issues.push('credits');
  if (!str(raw.course_code) && (str(raw.course_title) || credits != null)) issues.push('course code');
  return {
    courseCode: str(raw.course_code),
    courseTitle: str(raw.course_title),
    credits,
    offeredTerms: cleanTerms(raw.offered_terms),
    prereqGroups: cleanPrereqGroups(raw.prereq_groups),
    ...(issues.length ? { issues } : {}),
  };
}

function normalizeCategory(raw = {}) {
  const courses = (Array.isArray(raw.courses) ? raw.courses : []).map(normalizeCourse).filter(courseHasContent);
  const issues = [];
  if (!str(raw.name)) issues.push('category name');
  return {
    name: str(raw.name),
    creditsRequired: toInt(raw.credits_required),
    notes: str(raw.notes),
    courses,
    ...(issues.length ? { issues } : {}),
  };
}

const stripFences = (s) => String(s).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

/**
 * Extract the requirement structure from pasted text OR an uploaded photo/PDF.
 * Returns { program, categories } in camelCase, each category/course possibly
 * carrying an `issues` list for the review step. Never persists — the student
 * reviews first. Never throws on a malformed model response beyond a clean 502.
 */
export async function extractRequirements({ text, file } = {}) {
  const content = [];
  if (file) {
    const blocks = await fileContentBlocks(file, { label: 'requirements sheet' });
    if (!blocks.length) throw AppError.badRequest('Unsupported or empty file. Upload a photo, a PDF, or paste the text.');
    content.push(...blocks);
  } else if (text && String(text).trim()) {
    content.push({ type: 'text', text: `## Degree requirements (pasted):\n${String(text).trim().slice(0, 60000)}` });
  } else {
    throw AppError.badRequest('Paste your requirements or upload a photo/PDF.');
  }
  content.push({ type: 'text', text: EXTRACTION_PROMPT });

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 8192,
      output_config: { format: { type: 'json_schema', schema: programSchema } },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    throw new AppError(502, `Requirements extraction failed: ${err?.message || 'unknown error'}`);
  }

  if (message.stop_reason === 'refusal') throw AppError.badRequest('The model declined to process this input.');

  const rawText = message.content.find((b) => b.type === 'text')?.text ?? '';
  let data;
  try { data = JSON.parse(stripFences(rawText)); }
  catch { throw new AppError(502, 'Could not read the requirements from that input. Try pasting the text directly.'); }

  const program = {
    name: str(data?.program?.name),
    totalCredits: toInt(data?.program?.total_credits),
  };
  const categories = (Array.isArray(data?.categories) ? data.categories : [])
    .map(normalizeCategory)
    // Drop only fully-empty categories (no name, no credits, no notes, no courses).
    .filter((c) => c.name || c.creditsRequired != null || c.notes || c.courses.length);
  return { program, categories };
}

/* --------------------------------------------------------------- persistence */

function toPublicCourse(r) {
  return {
    id: r.id,
    courseCode: r.course_code,
    courseTitle: r.course_title,
    credits: r.credits == null ? null : Number(r.credits),
    offeredTerms: r.offered_terms ?? null,
    prereqGroups: r.prereq_groups ?? [],
  };
}

async function readRequirements(q, userId) {
  const { rows: pr } = await q('SELECT * FROM degree_programs WHERE user_id = $1', [userId]);
  if (!pr[0]) return { program: null, categories: [] };
  const program = pr[0];
  const { rows: cats } = await q(
    'SELECT * FROM requirement_categories WHERE program_id = $1 ORDER BY position, created_at',
    [program.id],
  );
  const { rows: courses } = await q(
    `SELECT rc.* FROM requirement_courses rc
       JOIN requirement_categories cat ON cat.id = rc.category_id
      WHERE cat.program_id = $1 ORDER BY rc.position, rc.created_at`,
    [program.id],
  );
  const byCat = new Map();
  for (const co of courses) {
    if (!byCat.has(co.category_id)) byCat.set(co.category_id, []);
    byCat.get(co.category_id).push(toPublicCourse(co));
  }
  return {
    program: { id: program.id, name: program.name, totalCredits: program.total_credits },
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      creditsRequired: c.credits_required,
      notes: c.notes,
      courses: byCat.get(c.id) || [],
    })),
  };
}

/** The user's degree program + categories + courses (null program if none). */
export async function getRequirements(userId) {
  return readRequirements(query, userId);
}

/**
 * Save the reviewed requirements. The payload is the FULL desired state of the
 * program's categories, so this is a transactional REPLACE: upsert the single
 * program, drop its existing categories (courses cascade), then re-insert.
 * Appending a minor sheet is a client-side merge into the review table before
 * this call — the server just persists whatever the table holds. Owner-scoped
 * via the UNIQUE(user_id) program row.
 */
export async function saveRequirements(userId, { program = {}, categories = [] } = {}) {
  return withTransaction(async (client) => {
    const { rows: pr } = await client.query(
      `INSERT INTO degree_programs (user_id, name, total_credits)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, total_credits = EXCLUDED.total_credits, updated_at = now()
       RETURNING id`,
      [userId, str(program.name), toInt(program.totalCredits ?? program.total_credits)],
    );
    const programId = pr[0].id;
    await client.query('DELETE FROM requirement_categories WHERE program_id = $1', [programId]);

    let ci = 0;
    for (const cat of categories) {
      const { rows: cr } = await client.query(
        `INSERT INTO requirement_categories (program_id, name, credits_required, notes, position)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [programId, str(cat.name), toInt(cat.creditsRequired), str(cat.notes), ci++],
      );
      const categoryId = cr[0].id;
      let coi = 0;
      for (const raw of Array.isArray(cat.courses) ? cat.courses : []) {
        const terms = cleanTerms(raw.offeredTerms);
        await client.query(
          `INSERT INTO requirement_courses (category_id, course_code, course_title, credits, offered_terms, prereq_groups, position)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
          [
            categoryId,
            str(raw.courseCode),
            str(raw.courseTitle),
            toInt(raw.credits),
            terms == null ? null : JSON.stringify(terms),
            JSON.stringify(cleanPrereqGroups(raw.prereqGroups)),
            coi++,
          ],
        );
      }
    }
    return readRequirements((t, p) => client.query(t, p), userId);
  });
}

/** Delete the user's degree program entirely (categories + courses cascade). */
export async function deleteRequirements(userId) {
  await query('DELETE FROM degree_programs WHERE user_id = $1', [userId]);
}
