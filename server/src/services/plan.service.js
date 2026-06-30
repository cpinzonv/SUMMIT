import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { createClass, archiveClass } from './class.service.js';

// Season ordering within a year, for chronological sorting.
const SEASON_RANK = { Spring: 1, Summer: 2, Fall: 3, Winter: 4 };

// Approximate term boundaries [monthIndex, day, yearOffset] used to (a) decide
// when a planned course's term has started, and (b) stamp the auto-created
// Dashboard class's start/end dates.
const TERM_START = { Spring: [0, 10], Summer: [5, 1], Fall: [7, 25], Winter: [11, 15] };
const TERM_END = { Spring: [4, 15, 0], Summer: [7, 10, 0], Fall: [11, 18, 0], Winter: [0, 5, 1] };

export function termStartDate(season, year) {
  const [m, d] = TERM_START[season] ?? [7, 25];
  return new Date(year, m, d);
}
export function termEndDate(season, year) {
  const [m, d, yo = 0] = TERM_END[season] ?? [11, 18, 0];
  return new Date(year + yo, m, d);
}
const fmtDate = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

function toPublicItem(row) {
  const pct = row.grade_percentage;
  return {
    id: row.id,
    year: row.year,
    season: row.season,
    term: `${row.season} ${row.year}`,
    name: row.name,
    code: row.code,
    credits: row.credits == null ? null : Number(row.credits),
    status: row.status,
    completionDate: row.completion_date ?? null,
    linkedClassId: row.linked_class_id ?? null,
    // Final grade, surfaced from the linked class's archive snapshot (Archived tab).
    grade:
      row.grade_letter != null || pct != null
        ? { letter: row.grade_letter ?? null, percentage: pct == null ? null : Number(pct) }
        : null,
  };
}

async function getOwnedItem(userId, itemId) {
  const { rows } = await query('SELECT * FROM plan_items WHERE id = $1 AND user_id = $2', [
    itemId,
    userId,
  ]);
  if (!rows[0]) throw AppError.notFound('Plan item not found');
  return rows[0];
}

/** Full plan, chronologically ordered, with credit totals + archived grades. */
export async function getPlan(userId) {
  const { rows } = await query(
    `SELECT p.*,
            a.snapshot->'finalGrade'->>'letter'     AS grade_letter,
            a.snapshot->'finalGrade'->>'percentage' AS grade_percentage
     FROM plan_items p
     LEFT JOIN archives a
       ON a.entity_type = 'class' AND a.entity_id = p.linked_class_id AND a.user_id = p.user_id
     WHERE p.user_id = $1
     ORDER BY p.year,
       CASE p.season
         WHEN 'Spring' THEN 1 WHEN 'Summer' THEN 2
         WHEN 'Fall' THEN 3 WHEN 'Winter' THEN 4 ELSE 5 END,
       p.name`,
    [userId],
  );
  const items = rows.map(toPublicItem);

  const sum = (pred) => items.reduce((t, it) => t + (pred(it) ? it.credits || 0 : 0), 0);

  return {
    items,
    summary: {
      totalCredits: sum(() => true),
      completedCredits: sum((it) => it.status === 'completed'),
      plannedCredits: sum((it) => it.status !== 'completed'),
    },
  };
}

/**
 * Auto-move: for every planned/in-progress course whose term has started and
 * that doesn't yet have a Dashboard class, create the class (linking both ways
 * and flipping the course to in-progress). Returns the courses that moved.
 * Idempotent — a course with linked_class_id set is skipped.
 */
export async function syncActiveCourses(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { rows } = await query(
    `SELECT * FROM plan_items
     WHERE user_id = $1 AND status <> 'completed' AND linked_class_id IS NULL`,
    [userId],
  );
  const due = rows.filter((r) => termStartDate(r.season, r.year) <= today);

  const created = [];
  for (const item of due) {
    const cls = await createClass(userId, {
      name: item.name,
      code: item.code ?? undefined,
      credits: item.credits == null ? undefined : Number(item.credits),
      term: `${item.season} ${item.year}`,
      startDate: fmtDate(termStartDate(item.season, item.year)),
      endDate: fmtDate(termEndDate(item.season, item.year)),
      plannerCourseId: item.id,
    });
    created.push({ classId: cls.id, name: item.name, term: `${item.season} ${item.year}` });
  }
  return { created, count: created.length };
}

export async function createPlanItem(userId, input) {
  if (!SEASON_RANK[input.season]) {
    throw AppError.badRequest('season must be Spring, Summer, Fall, or Winter');
  }
  const { rows } = await query(
    `INSERT INTO plan_items (user_id, year, season, name, code, credits, status)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::plan_status, 'planned'))
     RETURNING *`,
    [
      userId,
      input.year,
      input.season,
      input.name,
      input.code ?? null,
      input.credits ?? null,
      input.status ?? null,
    ],
  );
  return toPublicItem(rows[0]);
}

const UPDATABLE = {
  year: 'year',
  season: 'season',
  name: 'name',
  code: 'code',
  credits: 'credits',
  status: 'status',
};

export async function updatePlanItem(userId, itemId, input) {
  const existing = await getOwnedItem(userId, itemId);

  // Marking a course completed while it still has an active Dashboard class →
  // archive that class. archiveClass itself flips this plan item to completed
  // (+ completion_date) and snapshots the grade, keeping the two sides in sync.
  if (input.status === 'completed' && existing.linked_class_id) {
    await archiveClass(userId, existing.linked_class_id);
  }

  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (field in input) {
      sets.push(field === 'status' ? `status = $${i}::plan_status` : `${column} = $${i}`);
      values.push(input[field] ?? null);
      i++;
    }
  }
  // Keep completion_date consistent with status changes.
  if ('status' in input) {
    sets.push(
      input.status === 'completed'
        ? 'completion_date = COALESCE(completion_date, CURRENT_DATE)'
        : 'completion_date = NULL',
    );
  }
  if (sets.length > 0) {
    values.push(itemId);
    await query(`UPDATE plan_items SET ${sets.join(', ')} WHERE id = $${i}`, values);
  }
  return getOwnedItem(userId, itemId).then(toPublicItem);
}

export async function deletePlanItem(userId, itemId) {
  await getOwnedItem(userId, itemId);
  await query('DELETE FROM plan_items WHERE id = $1', [itemId]);
}
