import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

// Season ordering within a year, for chronological sorting.
const SEASON_RANK = { Spring: 1, Summer: 2, Fall: 3, Winter: 4 };

function toPublicItem(row) {
  return {
    id: row.id,
    year: row.year,
    season: row.season,
    term: `${row.season} ${row.year}`,
    name: row.name,
    code: row.code,
    credits: row.credits == null ? null : Number(row.credits),
    status: row.status,
  };
}

async function getOwnedItem(userId, itemId) {
  const { rows } = await query(
    'SELECT * FROM plan_items WHERE id = $1 AND user_id = $2',
    [itemId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Plan item not found');
  return rows[0];
}

/** Full plan, chronologically ordered, with credit totals. */
export async function getPlan(userId) {
  const { rows } = await query(
    `SELECT * FROM plan_items
     WHERE user_id = $1
     ORDER BY year,
       CASE season
         WHEN 'Spring' THEN 1 WHEN 'Summer' THEN 2
         WHEN 'Fall' THEN 3 WHEN 'Winter' THEN 4 ELSE 5 END,
       name`,
    [userId],
  );
  const items = rows.map(toPublicItem);

  const sum = (pred) =>
    items.reduce((t, it) => t + (pred(it) ? it.credits || 0 : 0), 0);

  return {
    items,
    summary: {
      totalCredits: sum(() => true),
      completedCredits: sum((it) => it.status === 'completed'),
      plannedCredits: sum((it) => it.status !== 'completed'),
    },
  };
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
  await getOwnedItem(userId, itemId);
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
