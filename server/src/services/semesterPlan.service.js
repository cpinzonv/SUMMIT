import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { fileContentBlocks } from './syllabus.service.js';

/**
 * Semester Schedule Builder — Stage A (Planner). Extracts available course
 * sections from a student's pasted / screenshotted registration listing, and
 * persists reviewed sections to a draft semester plan.
 *
 * Extraction reuses the syllabus-extraction pattern: a server-side Claude call
 * (never from the client) with a strict JSON-schema structured output, defensive
 * parsing, and per-row normalization/validation. NO schedule solving here.
 */

let client;
function getClient() {
  if (!env.anthropicApiKey) {
    throw new AppError(503, 'Section extraction is not configured. Set ANTHROPIC_API_KEY in the server environment.');
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Structured-output schema: an array of sections, every field nullable so the
// model extracts what's present and never invents. Multiple sections of one
// course come back as separate rows sharing course_code.
const sectionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          course_code: { type: ['string', 'null'], description: 'Department + number, e.g. "MATH 162"' },
          course_title: { type: ['string', 'null'] },
          section_number: { type: ['string', 'null'], description: 'e.g. "001" or "A"' },
          days: { type: 'array', items: { type: 'string', enum: WEEKDAYS } },
          start_time: { type: ['string', 'null'], description: '24-hour HH:MM wall-clock' },
          end_time: { type: ['string', 'null'], description: '24-hour HH:MM wall-clock' },
          professor: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          term: { type: ['string', 'null'] },
        },
        required: ['course_code', 'course_title', 'section_number', 'days', 'start_time', 'end_time', 'professor', 'location', 'term'],
      },
    },
  },
  required: ['sections'],
};

export const EXTRACTION_PROMPT = `You are extracting the list of AVAILABLE course sections from a university registration portal's course-listing (pasted text or a screenshot).

Return every section as a SEPARATE row. Multiple sections of the same course (e.g. MATH 162-001 and MATH 162-002) are separate rows that share the same course_code.

For each section:
- course_code: department + number, e.g. "MATH 162" (normalize spacing).
- course_title: the course name if shown.
- section_number: the section id, e.g. "001" or "A".
- days: the meeting weekdays as tokens from [Mon,Tue,Wed,Thu,Fri,Sat,Sun]. Expand combined forms: "MWF" -> [Mon,Wed,Fri]; "TR" or "TTh" -> [Tue,Thu]; "MW" -> [Mon,Wed]; "M-F" -> [Mon,Tue,Wed,Thu,Fri]. Empty array if no days are shown.
- start_time / end_time: 24-hour "HH:MM" wall-clock, e.g. "13:30". Convert "1:30 PM" -> "13:30". Do NOT apply any timezone. null if not shown.
- professor, location, term: exactly as shown, else null.

Use null for any field the listing does not show. NEVER invent data. Ignore headers, legends, page chrome, and rows that are not course sections. Return ONLY the JSON object.`;

/* -------------------------------------------------- extraction + normalizing */

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Coerce a time string to 24h 'HH:MM', or null if unparseable. */
function toHHMM(t) {
  if (t == null) return null;
  const s = String(t).trim();
  if (!s) return null;
  if (HHMM.test(s)) { const [h, m] = s.split(':'); return `${h.padStart(2, '0')}:${m}`; }
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(s);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (m[3]) { h %= 12; if (/p/i.test(m[3])) h += 12; }
    if (h < 24 && min < 60) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return null;
}

/** Filter a days array to canonical Mon..Sun tokens (deduped, ordered). */
function cleanDays(days) {
  if (!Array.isArray(days)) return [];
  const set = new Set();
  for (const d of days) {
    const k = String(d).slice(0, 3);
    const key = k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
    if (WEEKDAYS.includes(key)) set.add(key);
  }
  return WEEKDAYS.filter((d) => set.has(d));
}

/** Normalize one extracted (snake_case) row → camelCase, flagging issues for review. */
function normalizeExtracted(raw) {
  const start = toHHMM(raw.start_time);
  const end = toHHMM(raw.end_time);
  const issues = [];
  if (raw.start_time && !start) issues.push('start time');
  if (raw.end_time && !end) issues.push('end time');
  if (!raw.course_code) issues.push('course code');
  return {
    courseCode: raw.course_code ?? null,
    courseTitle: raw.course_title ?? null,
    sectionNumber: raw.section_number ?? null,
    days: cleanDays(raw.days),
    startTime: start,
    endTime: end,
    professor: raw.professor ?? null,
    location: raw.location ?? null,
    term: raw.term ?? null,
    ...(issues.length ? { issues } : {}),
  };
}

/** Clean a client-supplied (reviewed) camelCase section for persistence. */
function cleanForInsert(s = {}) {
  const str = (v) => { const t = v == null ? null : String(v).trim(); return t ? t.slice(0, 300) : null; };
  return {
    courseCode: str(s.courseCode),
    courseTitle: str(s.courseTitle),
    sectionNumber: str(s.sectionNumber),
    days: cleanDays(s.days),
    startTime: toHHMM(s.startTime),
    endTime: toHHMM(s.endTime),
    professor: str(s.professor),
    location: str(s.location),
    term: str(s.term),
  };
}

const stripFences = (s) => String(s).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

/**
 * Extract sections from raw pasted text OR an uploaded image. Returns an array
 * of normalized sections (camelCase), each possibly carrying an `issues` list
 * for the review step. Never persists — the student reviews first.
 */
export async function extractSections({ text, file } = {}) {
  const content = [];
  if (file) {
    const blocks = await fileContentBlocks(file);
    if (!blocks.length) throw AppError.badRequest('Unsupported or empty file. Upload a JPG or PNG screenshot, or paste the text.');
    content.push(...blocks);
  } else if (text && String(text).trim()) {
    content.push({ type: 'text', text: `## Course listing (pasted):\n${String(text).trim().slice(0, 60000)}` });
  } else {
    throw AppError.badRequest('Paste your course listing or upload a screenshot.');
  }
  content.push({ type: 'text', text: EXTRACTION_PROMPT });

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 8192,
      output_config: { format: { type: 'json_schema', schema: sectionsSchema } },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    throw new AppError(502, `Section extraction failed: ${err?.message || 'unknown error'}`);
  }

  if (message.stop_reason === 'refusal') throw AppError.badRequest('The model declined to process this input.');

  const rawText = message.content.find((b) => b.type === 'text')?.text ?? '';
  let data;
  try { data = JSON.parse(stripFences(rawText)); }
  catch { throw new AppError(502, 'Could not read the sections from that input. Try pasting the text directly.'); }

  const rows = Array.isArray(data?.sections) ? data.sections : [];
  // Drop fully-empty rows (no code, title, or times) but keep partial rows so
  // the student can fix them; flagged rows are never silently dropped.
  return rows
    .map(normalizeExtracted)
    .filter((s) => s.courseCode || s.courseTitle || s.startTime || s.days.length);
}

/* --------------------------------------------------------------- persistence */

function toPublicSection(r) {
  return {
    id: r.id,
    courseCode: r.course_code,
    courseTitle: r.course_title,
    sectionNumber: r.section_number,
    days: r.days ?? [],
    startTime: r.start_time,
    endTime: r.end_time,
    professor: r.professor,
    location: r.location,
    term: r.term,
    pinned: r.pinned ?? false,
  };
}

/** The user's draft plan for a term (created lazily). term null = the single default draft. */
export async function getOrCreateDraft(userId, term = null) {
  const found = await query(
    term
      ? 'SELECT * FROM draft_semester_plans WHERE user_id = $1 AND term = $2'
      : 'SELECT * FROM draft_semester_plans WHERE user_id = $1 ORDER BY created_at LIMIT 1',
    term ? [userId, term] : [userId],
  );
  if (found.rows[0]) return found.rows[0];
  const ins = await query('INSERT INTO draft_semester_plans (user_id, term) VALUES ($1, $2) RETURNING *', [userId, term]);
  return ins.rows[0];
}

async function sectionsForPlan(planId) {
  const { rows } = await query(
    `SELECT * FROM plan_sections WHERE plan_id = $1
      ORDER BY course_code NULLS LAST, section_number NULLS LAST, created_at`,
    [planId],
  );
  return rows.map(toPublicSection);
}

/** Per-course Required/Optional flags for a plan (course_code → required). */
async function requirementsForPlan(planId) {
  const { rows } = await query('SELECT course_code, required FROM plan_course_prefs WHERE plan_id = $1', [planId]);
  return rows.map((r) => ({ courseCode: r.course_code, required: r.required }));
}

/**
 * The user's draft plan + its sections + course requirement flags (creates an
 * empty draft if none). Courses without an explicit flag default to Required on
 * the client (Stage B), so we only persist/return the ones the student set.
 */
export async function getPlan(userId, term = null) {
  const plan = await getOrCreateDraft(userId, term);
  return {
    plan: { id: plan.id, term: plan.term },
    sections: await sectionsForPlan(plan.id),
    requirements: await requirementsForPlan(plan.id),
    preferences: plan.preferences ?? null,
  };
}

async function assertOwnedPlan(userId, planId) {
  const { rows } = await query('SELECT id FROM draft_semester_plans WHERE id = $1 AND user_id = $2', [planId, userId]);
  if (!rows[0]) throw AppError.notFound('Plan not found');
}
async function assertOwnedSection(userId, sectionId) {
  const { rows } = await query(
    `SELECT ps.id FROM plan_sections ps
       JOIN draft_semester_plans dp ON dp.id = ps.plan_id
      WHERE ps.id = $1 AND dp.user_id = $2`,
    [sectionId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Section not found');
}

/** Append reviewed sections to the user's draft plan (never overwrites). */
export async function appendSections(userId, planId, sections = []) {
  await assertOwnedPlan(userId, planId);
  const cleaned = sections.map(cleanForInsert);
  for (const s of cleaned) {
    await query(
      `INSERT INTO plan_sections
         (plan_id, course_code, course_title, section_number, days, start_time, end_time, professor, location, term)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
      [planId, s.courseCode, s.courseTitle, s.sectionNumber, JSON.stringify(s.days), s.startTime, s.endTime, s.professor, s.location, s.term],
    );
  }
  await query('UPDATE draft_semester_plans SET updated_at = now() WHERE id = $1', [planId]);
  return sectionsForPlan(planId);
}

const SECTION_COLUMNS = {
  courseCode: 'course_code', courseTitle: 'course_title', sectionNumber: 'section_number',
  startTime: 'start_time', endTime: 'end_time', professor: 'professor', location: 'location', term: 'term',
};

/** Update one section (owner-scoped). Only provided fields change. */
export async function updateSection(userId, sectionId, input = {}) {
  await assertOwnedSection(userId, sectionId);
  const clean = cleanForInsert({ ...input });
  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, column] of Object.entries(SECTION_COLUMNS)) {
    if (field in input) { sets.push(`${column} = $${i++}`); values.push(clean[field]); }
  }
  if ('days' in input) { sets.push(`days = $${i++}::jsonb`); values.push(JSON.stringify(clean.days)); }
  if ('pinned' in input) { sets.push(`pinned = $${i++}`); values.push(!!input.pinned); }
  if (sets.length) {
    sets.push('updated_at = now()');
    values.push(sectionId);
    await query(`UPDATE plan_sections SET ${sets.join(', ')} WHERE id = $${i}`, values);
  }
  const { rows } = await query('SELECT * FROM plan_sections WHERE id = $1', [sectionId]);
  return toPublicSection(rows[0]);
}

/** Delete one section (owner-scoped). */
export async function deleteSection(userId, sectionId) {
  await assertOwnedSection(userId, sectionId);
  await query('DELETE FROM plan_sections WHERE id = $1', [sectionId]);
}

/** Set the draft plan's term label (owner-scoped). */
export async function setPlanTerm(userId, planId, term) {
  await assertOwnedPlan(userId, planId);
  const clean = term == null ? null : String(term).trim().slice(0, 100) || null;
  await query('UPDATE draft_semester_plans SET term = $1, updated_at = now() WHERE id = $2', [clean, planId]);
  return getPlan(userId, clean);
}

/* ---------------------------------------------- Stage B: requirements + commit */

/** Mark a course Required or Optional within a plan (owner-scoped, upsert). */
export async function setCourseRequirement(userId, planId, courseCode, required) {
  await assertOwnedPlan(userId, planId);
  const code = String(courseCode ?? '').trim();
  if (!code) throw AppError.badRequest('A course code is required.');
  await query(
    `INSERT INTO plan_course_prefs (plan_id, course_code, required)
     VALUES ($1, $2, $3)
     ON CONFLICT (plan_id, course_code) DO UPDATE SET required = EXCLUDED.required, updated_at = now()`,
    [planId, code, !!required],
  );
  return requirementsForPlan(planId);
}

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

/** Parse a free-text term ("Spring 2027", "fall 2026") → { season, year } or null. */
export function parseTerm(term) {
  if (!term) return null;
  const s = String(term).trim();
  const season = SEASONS.find((se) => new RegExp(`\\b${se}\\b`, 'i').test(s));
  const year = s.match(/\b(20\d{2})\b/);
  return season && year ? { season, year: Number(year[1]) } : null;
}

/**
 * Write a chosen schedule into the Planner's 4-year roadmap: one plan_item per
 * chosen section for the plan's resolved term. The section's meeting details
 * ride along in section_meta so the roadmap keeps them. Idempotent per plan —
 * re-choosing replaces this plan's prior write-in (source_plan_id) but never
 * touches manually-added roadmap courses. The draft plan/sections are left
 * intact so the student can re-plan.
 */
export async function commitSchedule(userId, planId, sectionIds = []) {
  await assertOwnedPlan(userId, planId);
  if (!sectionIds.length) throw AppError.badRequest('Pick a schedule before adding it to your plan.');

  const { rows: planRows } = await query('SELECT term FROM draft_semester_plans WHERE id = $1', [planId]);
  const parsed = parseTerm(planRows[0]?.term);
  if (!parsed) {
    throw AppError.badRequest('Set a term like "Spring 2027" on this plan before adding a schedule to it.');
  }

  // Load the chosen sections, scoped to this owner + plan (ignore stray ids).
  const { rows: secs } = await query(
    `SELECT ps.* FROM plan_sections ps
       JOIN draft_semester_plans dp ON dp.id = ps.plan_id
      WHERE dp.user_id = $1 AND ps.plan_id = $2 AND ps.id = ANY($3::uuid[])
      ORDER BY ps.course_code NULLS LAST, ps.section_number NULLS LAST`,
    [userId, planId, sectionIds],
  );
  if (!secs.length) throw AppError.badRequest('None of those sections are in this plan.');

  // Replace any prior write-in from THIS plan (re-choosing a different schedule).
  await query('DELETE FROM plan_items WHERE user_id = $1 AND source_plan_id = $2', [userId, planId]);

  const created = [];
  for (const s of secs) {
    const sectionMeta = {
      sectionNumber: s.section_number,
      days: s.days ?? [],
      startTime: s.start_time,
      endTime: s.end_time,
      professor: s.professor,
      location: s.location,
    };
    const { rows } = await query(
      `INSERT INTO plan_items (user_id, year, season, name, code, section_meta, source_plan_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id, name, code`,
      [userId, parsed.year, parsed.season, s.course_title || s.course_code || 'Course', s.course_code, JSON.stringify(sectionMeta), planId],
    );
    created.push(rows[0]);
  }
  return { term: `${parsed.season} ${parsed.year}`, count: created.length, items: created };
}

/* ------------------------------------------ Stage C: preferences + AI advisor */

/** Persist the student's ranking preferences on the draft plan (owner-scoped). */
export async function setPreferences(userId, planId, preferences) {
  await assertOwnedPlan(userId, planId);
  await query('UPDATE draft_semester_plans SET preferences = $1::jsonb, updated_at = now() WHERE id = $2', [
    JSON.stringify(preferences ?? null),
    planId,
  ]);
  return preferences ?? null;
}

// Stable key over the top candidates (by section ids) + preferences, so re-opening
// the advisor with the same state is a cache hit and prefs/pins changes miss.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((o, k) => { o[k] = canonical(value[k]); return o; }, {});
  }
  return value;
}
export function hashAdvice(candidates = [], preferences = {}) {
  const key = { c: candidates.map((c) => [...(c.sectionIds || [])].sort()), p: canonical(preferences || {}) };
  return createHash('sha256').update(JSON.stringify(key)).digest('hex');
}

/** Cached advisor response for (plan, hash), owner-scoped. Null on miss. */
export async function getCachedAdvice(userId, planId, hash) {
  const { rows } = await query(
    `SELECT pa.response FROM plan_advice pa
       JOIN draft_semester_plans dp ON dp.id = pa.plan_id
      WHERE pa.plan_id = $1 AND pa.hash = $2 AND dp.user_id = $3`,
    [planId, hash, userId],
  );
  return rows[0]?.response ?? null;
}

const adviceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    advice: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
      },
    },
  },
  required: ['advice'],
};

export const ADVISOR_PROMPT = `You are a warm, level-headed academic advisor helping a college student choose between a few conflict-free class schedules for an upcoming term. You are given the student's stated preferences and 2–3 candidate schedules, already ranked best-fit first.

For EACH candidate, write 2–3 sentences in a calm, peer-to-peer voice that honestly compares its tradeoffs — what it gives the student and what it costs — against the other candidates and their preferences. Ground every point in the concrete facts provided (days off, earliest/latest times, gaps, professors, days on campus, listed tradeoffs). Compare candidates to each other where useful ("A frees your Fridays but stacks Tuesday; B is lighter but means five days on campus").

Rules: never invent a detail that is not in the summaries. Do not tell the student which to pick — illuminate the tradeoffs and let them decide. No exclamation points. Keep each entry to 2–3 sentences.

Return ONLY JSON of the form { "advice": [ { "id": "<candidate id>", "text": "<2-3 sentences>" } ] }, with exactly one entry per candidate id given.`;

function prefsToText(p = {}) {
  const parts = [];
  if (p.earliestStart) parts.push(`no classes before ${p.earliestStart}`);
  if (p.latestEnd) parts.push(`nothing after ${p.latestEnd}`);
  if (Array.isArray(p.daysFree) && p.daysFree.length) parts.push(`wants ${p.daysFree.join('/')} free`);
  if (p.gapStyle === 'minimize') parts.push('prefers minimal gaps between classes');
  if (p.gapStyle === 'spread') parts.push('prefers classes spread out');
  if (p.fewerDays) parts.push('prefers fewer days on campus');
  if (p.professors) {
    const pick = (flag) => Object.entries(p.professors).filter(([, v]) => v === flag).map(([k]) => k);
    if (pick('prefer').length) parts.push(`prefers ${pick('prefer').join(', ')}`);
    if (pick('avoid').length) parts.push(`wants to avoid ${pick('avoid').join(', ')}`);
  }
  return parts.length ? parts.join('; ') : 'no specific preferences';
}

function candidateToText(c) {
  const perDay = c.perDay ? Object.entries(c.perDay).map(([d, v]) => `${d}: ${v}`).join(' | ') : '';
  return [
    `Candidate ${c.id}${c.label ? ` (${c.label})` : ''}:`,
    `  Days on campus: ${c.daysOnCampus}`,
    c.earliest != null && `  Earliest start ${c.earliest}, latest end ${c.latest}`,
    c.gapHours != null && `  Total gap time between classes: ${c.gapHours}h`,
    Array.isArray(c.professors) && c.professors.length && `  Professors: ${c.professors.join(', ')}`,
    perDay && `  Weekly layout — ${perDay}`,
    Array.isArray(c.compromises) && c.compromises.length && `  Known tradeoffs: ${c.compromises.join('; ')}`,
  ].filter(Boolean).join('\n');
}

/**
 * The single Stage C Claude call: explain the tradeoffs of the top ranked
 * candidates. Server-side only, strict JSON, parsed defensively, and cached per
 * (candidates+prefs) hash so re-opening doesn't re-bill. Throws 5xx on failure
 * (usage is then refunded by enforceUsage) — the client keeps the ranking usable
 * without advice.
 */
export async function adviseSchedules(userId, planId, { candidates = [], preferences = {} } = {}, hash) {
  await assertOwnedPlan(userId, planId);
  if (!candidates.length) throw AppError.badRequest('No schedules to explain yet.');

  const prompt = [
    ADVISOR_PROMPT,
    `\nSTUDENT PREFERENCES: ${prefsToText(preferences)}`,
    '\nCANDIDATES (ranked best-fit first):',
    candidates.map(candidateToText).join('\n\n'),
    '\nReturn ONLY the JSON described above — one advice entry per candidate id.',
  ].join('\n');

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 1500,
      output_config: { format: { type: 'json_schema', schema: adviceSchema } },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    throw new AppError(502, `The advisor could not respond: ${err?.message || 'unknown error'}`);
  }
  if (message.stop_reason === 'refusal') throw new AppError(502, 'The advisor declined to respond.');

  const rawText = message.content.find((b) => b.type === 'text')?.text ?? '';
  let data;
  try { data = JSON.parse(stripFences(rawText)); }
  catch { throw new AppError(502, 'Could not read the advisor response.'); }

  const advice = (Array.isArray(data?.advice) ? data.advice : [])
    .filter((a) => a && a.id != null && a.text)
    .map((a) => ({ id: String(a.id), text: String(a.text) }));
  if (!advice.length) throw new AppError(502, 'The advisor returned nothing usable.');

  const response = { advice };
  await query(
    `INSERT INTO plan_advice (plan_id, hash, response) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (plan_id) DO UPDATE SET hash = EXCLUDED.hash, response = EXCLUDED.response, created_at = now()`,
    [planId, hash, JSON.stringify(response)],
  );
  return response;
}
