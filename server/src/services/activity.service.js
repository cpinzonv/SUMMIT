/**
 * Activities — 3-level anti-procrastination hierarchy: Activity → Project → Task.
 * Owner-scoped. See docs/activities.md.
 *
 *   - Task done = completed_at is set; due dates optional (Option C).
 *   - Project stage carries the Kanban column (Backlog/Active/In Progress/Done).
 *   - Progress aggregates upward: project = its tasks; activity = ALL its tasks.
 *   - Auto-complete (Decision #4): all tasks done → project 'done'; all projects
 *     done → activity 'done'. Reverts when no longer all-done. Reconciled on change.
 *   - Projects nudge toward 3+ tasks in the UI, but never require them (Option C).
 */
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

const KINDS = ['club', 'extracurricular', 'freelance', 'volunteer', 'other'];
const STAGES = ['backlog', 'active', 'in_progress', 'done'];

/* ---- shaping ------------------------------------------------------------ */
const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
};

function toTask(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description ?? null,
    dueDate: r.due_date ?? null,
    plannedDate: r.planned_date ?? null,
    sortOrder: r.sort_order,
    done: Boolean(r.completed_at),
    completedAt: r.completed_at ?? null,
  };
}

function progressOf(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

function toProject(row, taskRows) {
  const tasks = taskRows.map(toTask).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: row.id,
    activityId: row.activity_id,
    name: row.name,
    description: row.description ?? null,
    stage: row.stage,
    sortOrder: row.sort_order,
    completedAt: row.completed_at ?? null,
    tasks,
    progress: progressOf(tasks),
  };
}

// Activity-level "next action" — the closest-due incomplete task across all projects.
function nextActionOf(allTasks) {
  const open = allTasks.filter((t) => !t.done);
  if (open.length === 0) return null;
  const dated = open.filter((t) => t.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const pick = dated[0] || open.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return pick ? { id: pick.id, title: pick.title, dueDate: pick.dueDate ?? null } : null;
}

function toActivity(row, projects) {
  const allTasks = projects.flatMap((p) => p.tasks);
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
    projects,
    projectCount: projects.length,
    progress: progressOf(allTasks),   // aggregate of all tasks in all projects
    nextAction: nextActionOf(allTasks),
  };
}

/* ---- ownership ---------------------------------------------------------- */
async function ownedActivityRow(userId, id) {
  const { rows } = await query('SELECT * FROM activities WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) throw AppError.notFound('Activity not found');
  return rows[0];
}
async function ownedProjectRow(userId, projectId) {
  const { rows } = await query(
    `SELECT p.* FROM activity_projects p JOIN activities a ON a.id = p.activity_id
      WHERE p.id = $1 AND a.user_id = $2`,
    [projectId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Project not found');
  return rows[0];
}
async function ownedTaskRow(userId, taskId) {
  const { rows } = await query(
    `SELECT t.* FROM activity_tasks t
       JOIN activity_projects p ON p.id = t.project_id
       JOIN activities a ON a.id = p.activity_id
      WHERE t.id = $1 AND a.user_id = $2`,
    [taskId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Task not found');
  return rows[0];
}

/* ---- assembly ----------------------------------------------------------- */
async function assemble(activityRows) {
  if (activityRows.length === 0) return [];
  const aIds = activityRows.map((a) => a.id);
  const { rows: pRows } = await query(
    'SELECT * FROM activity_projects WHERE activity_id = ANY($1) ORDER BY sort_order, created_at',
    [aIds],
  );
  const pIds = pRows.map((p) => p.id);
  const tRows = pIds.length
    ? (await query('SELECT * FROM activity_tasks WHERE project_id = ANY($1) ORDER BY sort_order, created_at', [pIds])).rows
    : [];
  const tasksByProject = groupBy(tRows, 'project_id');
  const projectsByActivity = new Map();
  for (const p of pRows) {
    const proj = toProject(p, tasksByProject.get(p.id) || []);
    if (!projectsByActivity.has(p.activity_id)) projectsByActivity.set(p.activity_id, []);
    projectsByActivity.get(p.activity_id).push(proj);
  }
  return activityRows.map((a) => toActivity(a, projectsByActivity.get(a.id) || []));
}

export async function listActivities(userId) {
  const { rows } = await query(
    'SELECT * FROM activities WHERE user_id = $1 AND archived_at IS NULL ORDER BY created_at DESC',
    [userId],
  );
  return { activities: await assemble(rows) };
}

export async function getActivity(userId, id) {
  const row = await ownedActivityRow(userId, id);
  return (await assemble([row]))[0];
}

/* ---- auto-complete reconcile ------------------------------------------- */
async function reconcileActivity(activityId) {
  const { rows } = await query('SELECT stage FROM activity_projects WHERE activity_id = $1', [activityId]);
  const { rows: aRows } = await query('SELECT stage FROM activities WHERE id = $1', [activityId]);
  const stage = aRows[0]?.stage;
  const allDone = rows.length > 0 && rows.every((r) => r.stage === 'done');
  if (allDone && stage !== 'done') await query("UPDATE activities SET stage='done', completed_at=now() WHERE id=$1", [activityId]);
  else if (!allDone && stage === 'done') await query("UPDATE activities SET stage='in_progress', completed_at=NULL WHERE id=$1", [activityId]);
}
async function reconcileProject(projectId) {
  const { rows } = await query('SELECT completed_at FROM activity_tasks WHERE project_id = $1', [projectId]);
  const { rows: pRows } = await query('SELECT activity_id, stage FROM activity_projects WHERE id = $1', [projectId]);
  if (!pRows[0]) return;
  const stage = pRows[0].stage;
  const allDone = rows.length > 0 && rows.every((r) => r.completed_at);
  if (allDone && stage !== 'done') await query("UPDATE activity_projects SET stage='done', completed_at=now() WHERE id=$1", [projectId]);
  else if (!allDone && stage === 'done') await query("UPDATE activity_projects SET stage='in_progress', completed_at=NULL WHERE id=$1", [projectId]);
  await reconcileActivity(pRows[0].activity_id);
}

/* ---- activities --------------------------------------------------------- */
export async function createActivity(userId, input) {
  const name = (input.name || '').trim();
  if (!name) throw AppError.badRequest('Give the activity a name.');
  const kind = KINDS.includes(input.kind) ? input.kind : 'other';
  const { rows } = await query(
    `INSERT INTO activities (user_id, name, description, color, kind)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, name, input.description?.trim() || null, input.color || null, kind],
  );
  return getActivity(userId, rows[0].id);
}

const ACTIVITY_EDITABLE = { name: 'name', description: 'description', color: 'color', kind: 'kind' };
export async function updateActivity(userId, id, input) {
  await ownedActivityRow(userId, id);
  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, col] of Object.entries(ACTIVITY_EDITABLE)) {
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

export async function deleteActivity(userId, id) {
  const { rowCount } = await query('DELETE FROM activities WHERE id = $1 AND user_id = $2', [id, userId]);
  if (rowCount === 0) throw AppError.notFound('Activity not found');
}

/* ---- projects ----------------------------------------------------------- */
export async function addProject(userId, activityId, input) {
  await ownedActivityRow(userId, activityId);
  const name = (input.name || '').trim();
  if (!name) throw AppError.badRequest('Give the project a name.');
  // Optional tasks (Option C) — empty-title rows dropped.
  const tasks = (Array.isArray(input.tasks) ? input.tasks : [])
    .map((t) => ({ title: (t.title || '').trim(), dueDate: t.dueDate || null }))
    .filter((t) => t.title);

  await withTransaction(async (client) => {
    const { rows: ord } = await client.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM activity_projects WHERE activity_id = $1', [activityId]);
    const { rows } = await client.query(
      `INSERT INTO activity_projects (activity_id, name, description, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [activityId, name, input.description?.trim() || null, ord[0].n],
    );
    const projectId = rows[0].id;
    for (let i = 0; i < tasks.length; i++) {
      await client.query(
        `INSERT INTO activity_tasks (project_id, title, due_date, sort_order) VALUES ($1, $2, $3, $4)`,
        [projectId, tasks[i].title, tasks[i].dueDate, i],
      );
    }
  });
  return getActivity(userId, activityId); // after commit — so the new rows are visible
}

export async function updateProject(userId, projectId, input) {
  const p = await ownedProjectRow(userId, projectId);
  const sets = [];
  const values = [];
  let i = 1;
  if ('name' in input) { sets.push(`name = $${i++}`); values.push((input.name || '').trim() || p.name); }
  if ('description' in input) { sets.push(`description = $${i++}`); values.push(input.description ?? null); }
  if (sets.length > 0) {
    values.push(projectId);
    await query(`UPDATE activity_projects SET ${sets.join(', ')} WHERE id = $${i}`, values);
  }
  return getActivity(userId, p.activity_id);
}

export async function setProjectStage(userId, projectId, stage) {
  const p = await ownedProjectRow(userId, projectId);
  if (!STAGES.includes(stage)) throw AppError.badRequest('Invalid stage.');
  await query(
    `UPDATE activity_projects SET stage = $2, completed_at = ${stage === 'done' ? 'now()' : 'NULL'} WHERE id = $1`,
    [projectId, stage],
  );
  await reconcileActivity(p.activity_id);
  return getActivity(userId, p.activity_id);
}

export async function deleteProject(userId, projectId) {
  const p = await ownedProjectRow(userId, projectId);
  await query('DELETE FROM activity_projects WHERE id = $1', [projectId]);
  await reconcileActivity(p.activity_id);
  return getActivity(userId, p.activity_id);
}

/* ---- tasks -------------------------------------------------------------- */
export async function addTask(userId, projectId, input) {
  const p = await ownedProjectRow(userId, projectId);
  const title = (input.title || '').trim();
  if (!title) throw AppError.badRequest('Give the task a title.');
  const { rows: ord } = await query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM activity_tasks WHERE project_id = $1', [projectId]);
  await query(
    `INSERT INTO activity_tasks (project_id, title, description, due_date, planned_date, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [projectId, title, input.description?.trim() || null, input.dueDate || null, input.plannedDate || null, ord[0].n],
  );
  await reconcileProject(projectId);
  return getActivity(userId, p.activity_id);
}

export async function updateTask(userId, taskId, input) {
  const task = await ownedTaskRow(userId, taskId);
  const sets = [];
  const values = [];
  let i = 1;
  if ('title' in input) { sets.push(`title = $${i++}`); values.push((input.title || '').trim() || task.title); }
  if ('description' in input) { sets.push(`description = $${i++}`); values.push(input.description?.trim() || null); }
  if ('dueDate' in input) { sets.push(`due_date = $${i++}`); values.push(input.dueDate || null); }
  if ('plannedDate' in input) { sets.push(`planned_date = $${i++}`); values.push(input.plannedDate || null); }
  if ('done' in input) { sets.push(`completed_at = ${input.done ? 'now()' : 'NULL'}`); }
  if (sets.length > 0) {
    values.push(taskId);
    await query(`UPDATE activity_tasks SET ${sets.join(', ')} WHERE id = $${i}`, values);
  }
  const { rows: pr } = await query('SELECT activity_id FROM activity_projects WHERE id = $1', [task.project_id]);
  await reconcileProject(task.project_id);
  return getActivity(userId, pr[0].activity_id);
}

export async function deleteTask(userId, taskId) {
  const task = await ownedTaskRow(userId, taskId);
  const { rows: pr } = await query('SELECT activity_id FROM activity_projects WHERE id = $1', [task.project_id]);
  await query('DELETE FROM activity_tasks WHERE id = $1', [taskId]);
  await reconcileProject(task.project_id);
  return getActivity(userId, pr[0].activity_id);
}
