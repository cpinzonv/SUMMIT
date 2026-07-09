/**
 * To-Do feed — one unified list of cards that powers BOTH the calendar and the
 * Kanban board. Cards come from two sources, kept as a single source of truth:
 *   - assignments (across all the user's classes)
 *   - activity_tasks (across all the user's non-archived activities)
 *
 * board_stage (backlog · planning · in_progress · done) is the board axis;
 * due_date / planned_date are the calendar axis. Both views read this feed, so a
 * change in either view shows up in the other.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

const STAGES = ['backlog', 'planning', 'in_progress', 'done'];

function toCard(row) {
  return {
    id: row.id,
    source: row.source, // 'assignment' | 'task'
    title: row.title,
    dueDate: row.due_date,
    plannedDate: row.planned_date,
    boardStage: row.board_stage,
    done: row.board_stage === 'done',
    priority: row.priority ?? 'none',
    contextId: row.context_id, // classId or activityId (for click-through)
    contextName: row.context_name,
    color: row.color ?? null,
  };
}

/** Every to-do card the user owns, from both sources. */
export async function listTodo(userId) {
  const { rows } = await query(
    `SELECT a.id, 'assignment' AS source, a.title, a.due_date, a.planned_date,
            a.board_stage, a.priority::text AS priority,
            a.class_id AS context_id, c.name AS context_name, c.color
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
      WHERE c.user_id = $1
     UNION ALL
     SELECT t.id, 'task' AS source, t.title, t.due_date, t.planned_date,
            t.board_stage, 'none' AS priority,
            act.id AS context_id, act.name AS context_name, act.color
       FROM activity_tasks t
       JOIN activity_projects p ON p.id = t.project_id
       JOIN activities act ON act.id = p.activity_id
      WHERE act.user_id = $1 AND act.archived_at IS NULL
      ORDER BY due_date NULLS LAST, title`,
    [userId],
  );
  return rows.map(toCard);
}

/**
 * Move a card to another board column (owner-scoped). Moving to/from `done`
 * keeps the underlying completion in sync: assignments stamp completed_at, and
 * activity tasks — whose done-state IS completed_at — get it set/cleared too.
 */
export async function setStage(userId, source, id, stage) {
  if (!STAGES.includes(stage)) throw AppError.badRequest('Invalid stage');
  const done = stage === 'done';

  if (source === 'assignment') {
    const { rowCount } = await query(
      `UPDATE assignments a
          SET board_stage = $1::board_stage,
              completed_at = CASE WHEN $2 THEN COALESCE(a.completed_at, now()) ELSE NULL END
         FROM classes c
        WHERE a.id = $3 AND a.class_id = c.id AND c.user_id = $4`,
      [stage, done, id, userId],
    );
    if (!rowCount) throw AppError.notFound('Assignment not found');
  } else if (source === 'task') {
    const { rowCount } = await query(
      `UPDATE activity_tasks t
          SET board_stage = $1::board_stage,
              completed_at = CASE WHEN $2 THEN COALESCE(t.completed_at, now()) ELSE NULL END
         FROM activity_projects p
         JOIN activities act ON act.id = p.activity_id
        WHERE t.id = $3 AND t.project_id = p.id AND act.user_id = $4`,
      [stage, done, id, userId],
    );
    if (!rowCount) throw AppError.notFound('Task not found');
  } else {
    throw AppError.badRequest('Invalid source');
  }
}
