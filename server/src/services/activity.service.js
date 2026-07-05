/**
 * Activities — anti-procrastination projects for non-class work. Owner-scoped.
 * See docs/activities.md.
 *
 * Design notes:
 *   - Sub-tasks + their due dates are OPTIONAL (Decision #6 / Option C) — the
 *     create flow biases toward breakdown but never blocks.
 *   - Auto-complete (Decision #4): whenever tasks change, if every task is done
 *     the activity moves to 'done'; if it's no longer all-done, it drops back to
 *     'in_progress'. Recomputed on add/update/delete.
 *   - WIP cap (3 in-flight = active + in_progress) is reported here; hard
 *     enforcement on stage moves lands in Phase B.
 */
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

export const WIP_LIMIT = 3;
const KINDS = ['club', 'extracurricular', 'freelance', 'volunteer', 'other'];
const IN_FLIGHT = ['active', 'in_progress'];

function toTask(r) {
  return {
    id: r.id,
    activityId: r.activity_id,
    title: r.title,
    description: r.description ?? null,
    dueDate: r.due_date ?? null,
    plannedDate: r.planned_date ?? null,
    status: r.status,
    sortOrder: r.sort_order,
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at,
  };
}

function progressOf(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

// Closest-due not-done task (dated first, then by sort order) — the "Next action".
function nextActionOf(tasks) {
  const open = tasks.filter((t) => t.status !== 'done');
  if (open.length === 0) return null;
  const dated = open.filter((t) => t.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const pick = dated[0] || open.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return pick ? { id: pick.id, title: pick.title, dueDate: pick.dueDate ?? null } : null;
}

function toActivity(row, taskRows) {
  const tasks = taskRows.map(toTask).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    color: row.color ?? null,
    kind: row.kind,
    stage: row.stage,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tasks,
    progress: progressOf(tasks),
    nextAction: nextActionOf(tasks),
  };
}

async function ownedActivityRow(userId, id) {
  const { rows } = await query('SELECT * FROM activities WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) throw AppError.notFound('Activity not found');
  return rows[0];
}

async function tasksFor(activityIds) {
  if (activityIds.length === 0) return new Map();
  const { rows } = await query(
    'SELECT * FROM activity_tasks WHERE activity_id = ANY($1) ORDER BY sort_order, created_at',
    [activityIds],
  );
  const byActivity = new Map();
  for (const r of rows) {
    if (!byActivity.has(r.activity_id)) byActivity.set(r.activity_id, []);
    byActivity.get(r.activity_id).push(r);
  }
  return byActivity;
}

/** Live in-flight count (active + in_progress) for the WIP counter. */
export async function wipStatus(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM activities
      WHERE user_id = $1 AND archived_at IS NULL AND stage = ANY($2)`,
    [userId, IN_FLIGHT],
  );
  return { count: rows[0].n, limit: WIP_LIMIT };
}

export async function listActivities(userId) {
  const { rows } = await query(
    'SELECT * FROM activities WHERE user_id = $1 AND archived_at IS NULL ORDER BY created_at DESC',
    [userId],
  );
  const byActivity = await tasksFor(rows.map((r) => r.id));
  const activities = rows.map((r) => toActivity(r, byActivity.get(r.id) || []));
  return { activities, wip: await wipStatus(userId) };
}

export async function getActivity(userId, id) {
  const row = await ownedActivityRow(userId, id);
  const byActivity = await tasksFor([id]);
  return toActivity(row, byActivity.get(id) || []);
}

/**
 * Create an activity + its sub-tasks atomically. Tasks are optional and can be
 * fewer than three (Option C); empty-title rows are dropped. Each task's due
 * date is optional.
 */
export async function createActivity(userId, input) {
  const name = (input.name || '').trim();
  if (!name) throw AppError.badRequest('Give the activity a name.');
  const kind = KINDS.includes(input.kind) ? input.kind : 'other';
  const tasks = (Array.isArray(input.tasks) ? input.tasks : [])
    .map((t) => ({
      title: (t.title || '').trim(),
      description: t.description?.trim() || null,
      dueDate: t.dueDate || null,
      plannedDate: t.plannedDate || null,
    }))
    .filter((t) => t.title);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO activities (user_id, name, description, color, kind)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, name, input.description?.trim() || null, input.color || null, kind],
    );
    const activity = rows[0];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      await client.query(
        `INSERT INTO activity_tasks (activity_id, title, description, due_date, planned_date, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [activity.id, t.title, t.description, t.dueDate, t.plannedDate, i],
      );
    }
    const byActivity = await (async () => {
      const { rows: tr } = await client.query('SELECT * FROM activity_tasks WHERE activity_id = $1 ORDER BY sort_order', [activity.id]);
      return tr;
    })();
    return toActivity(activity, byActivity);
  });
}

const EDITABLE = { name: 'name', description: 'description', color: 'color', kind: 'kind' };

export async function updateActivity(userId, id, input) {
  await ownedActivityRow(userId, id);
  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, col] of Object.entries(EDITABLE)) {
    if (field in input) {
      sets.push(`${col} = $${i++}`);
      values.push(field === 'kind' && !KINDS.includes(input[field]) ? 'other' : input[field] ?? null);
    }
  }
  if (sets.length > 0) {
    values.push(id);
    await query(`UPDATE activities SET ${sets.join(', ')} WHERE id = $${i}`, values);
  }
  return getActivity(userId, id);
}

/** Move an activity to a Kanban stage. (WIP enforcement arrives in Phase B.) */
export async function setStage(userId, id, stage) {
  await ownedActivityRow(userId, id);
  const stages = ['backlog', 'active', 'in_progress', 'done'];
  if (!stages.includes(stage)) throw AppError.badRequest('Invalid stage.');
  await query(
    `UPDATE activities SET stage = $2, completed_at = ${stage === 'done' ? 'now()' : 'NULL'} WHERE id = $1`,
    [id, stage],
  );
  return getActivity(userId, id);
}

export async function deleteActivity(userId, id) {
  const { rowCount } = await query('DELETE FROM activities WHERE id = $1 AND user_id = $2', [id, userId]);
  if (rowCount === 0) throw AppError.notFound('Activity not found');
}

/* ---- Sub-tasks ---------------------------------------------------------- */

async function ownedTaskRow(userId, taskId) {
  const { rows } = await query(
    `SELECT t.* FROM activity_tasks t JOIN activities a ON a.id = t.activity_id
      WHERE t.id = $1 AND a.user_id = $2`,
    [taskId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Task not found');
  return rows[0];
}

// Auto-complete (Decision #4): keep the activity's stage in sync with its tasks —
// all done → 'done'; otherwise if it was 'done', drop back to 'in_progress'.
async function reconcileStage(activityId) {
  const { rows } = await query('SELECT status FROM activity_tasks WHERE activity_id = $1', [activityId]);
  const { rows: aRows } = await query('SELECT stage FROM activities WHERE id = $1', [activityId]);
  const stage = aRows[0]?.stage;
  const total = rows.length;
  const allDone = total > 0 && rows.every((r) => r.status === 'done');
  if (allDone && stage !== 'done') {
    await query("UPDATE activities SET stage = 'done', completed_at = now() WHERE id = $1", [activityId]);
  } else if (!allDone && stage === 'done') {
    await query("UPDATE activities SET stage = 'in_progress', completed_at = NULL WHERE id = $1", [activityId]);
  }
}

export async function addTask(userId, activityId, input) {
  await ownedActivityRow(userId, activityId);
  const title = (input.title || '').trim();
  if (!title) throw AppError.badRequest('Give the step a title.');
  const { rows } = await query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM activity_tasks WHERE activity_id = $1', [activityId]);
  await query(
    `INSERT INTO activity_tasks (activity_id, title, description, due_date, planned_date, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [activityId, title, input.description?.trim() || null, input.dueDate || null, input.plannedDate || null, rows[0].n],
  );
  await reconcileStage(activityId);
  return getActivity(userId, activityId);
}

export async function updateTask(userId, taskId, input) {
  const task = await ownedTaskRow(userId, taskId);
  const sets = [];
  const values = [];
  let i = 1;
  const cols = { title: 'title', description: 'description', dueDate: 'due_date', plannedDate: 'planned_date' };
  for (const [field, col] of Object.entries(cols)) {
    if (field in input) {
      sets.push(`${col} = $${i++}`);
      values.push(input[field] ?? null);
    }
  }
  if ('status' in input) {
    const s = ['not_started', 'in_progress', 'done'].includes(input.status) ? input.status : task.status;
    sets.push(`status = $${i++}`);
    values.push(s);
    sets.push(`completed_at = ${s === 'done' ? 'now()' : 'NULL'}`);
  }
  if (sets.length > 0) {
    values.push(taskId);
    await query(`UPDATE activity_tasks SET ${sets.join(', ')} WHERE id = $${i}`, values);
  }
  await reconcileStage(task.activity_id);
  return getActivity(userId, task.activity_id);
}

export async function deleteTask(userId, taskId) {
  const task = await ownedTaskRow(userId, taskId);
  await query('DELETE FROM activity_tasks WHERE id = $1', [taskId]);
  await reconcileStage(task.activity_id);
  return getActivity(userId, task.activity_id);
}
