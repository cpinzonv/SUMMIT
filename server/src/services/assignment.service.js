import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';

function toPublicAssignment(row) {
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    description: row.description,
    category: row.category,
    dueDate: row.due_date,
    plannedDate: row.planned_date,
    pointValue: row.point_value == null ? null : Number(row.point_value),
    estimatedHours: row.estimated_hours == null ? null : Number(row.estimated_hours),
    status: row.status,
    stage: row.stage ?? 'planning', // Kanban column (independent of academic status)
    completedAt: row.completed_at ?? null,
    submissionText: row.submission_text ?? null,
    priority: row.priority ?? 'none',
    externalSource: row.external_source ?? null, // 'canvas' if synced from an LMS
    grade:
      row.grade_id == null
        ? null
        : {
            id: row.grade_id,
            pointsEarned: Number(row.points_earned),
            pointsPossible: Number(row.points_possible),
            feedback: row.feedback,
            gradedAt: row.graded_at,
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fetch a single assignment joined with its grade, mapped to the API shape. */
async function fetchPublicAssignment(assignmentId, db = { query }) {
  const { rows } = await db.query(
    `SELECT a.*,
            g.id AS grade_id, g.points_earned, g.points_possible,
            g.feedback, g.graded_at
     FROM assignments a
     LEFT JOIN grades g ON g.assignment_id = a.id
     WHERE a.id = $1`,
    [assignmentId],
  );
  return rows[0] ? toPublicAssignment(rows[0]) : null;
}

/**
 * Fetch an assignment scoped to its owner (via the parent class). Throws 404 if
 * it doesn't exist or belongs to another user.
 */
export async function getOwnedAssignment(userId, assignmentId, db = { query }) {
  const { rows } = await db.query(
    `SELECT a.*
     FROM assignments a
     JOIN classes c ON c.id = a.class_id
     WHERE a.id = $1 AND c.user_id = $2`,
    [assignmentId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Assignment not found');
  return rows[0];
}

/** Create an assignment in a class the user owns. Stores due_date AND planned_date. */
export async function createAssignment(userId, classId, input) {
  await getOwnedClass(userId, classId); // 404s if not owned

  const { rows } = await query(
    `INSERT INTO assignments
       (class_id, title, description, category, due_date, planned_date,
        point_value, status, priority, estimated_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
             COALESCE($8::assignment_status, 'not_started'),
             COALESCE($9::assignment_priority, 'none'),
             $10)
     RETURNING id`,
    [
      classId,
      input.title,
      input.description ?? null,
      input.category ?? null,
      input.dueDate ?? null,
      input.plannedDate ?? null,
      input.pointValue ?? null,
      input.status ?? null,
      input.priority ?? null,
      input.estimatedHours ?? null,
    ],
  );
  return fetchPublicAssignment(rows[0].id);
}

// API field -> column mapping for partial updates.
const UPDATABLE = {
  title: 'title',
  description: 'description',
  category: 'category',
  dueDate: 'due_date',
  plannedDate: 'planned_date',
  pointValue: 'point_value',
  status: 'status',
  priority: 'priority',
  estimatedHours: 'estimated_hours',
  submissionText: 'submission_text',
};

// Enum columns need a cast on the placeholder so a text value type-checks.
const ENUM_CAST = { status: 'assignment_status', priority: 'assignment_priority' };

/** Partially update an assignment the user owns. Only provided fields change. */
export async function updateAssignment(userId, assignmentId, input) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned

  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (field in input) {
      sets.push(
        ENUM_CAST[field] ? `${column} = $${i}::${ENUM_CAST[field]}` : `${column} = $${i}`,
      );
      values.push(input[field] ?? null);
      i++;
    }
  }

  if (sets.length > 0) {
    values.push(assignmentId);
    await query(
      `UPDATE assignments SET ${sets.join(', ')} WHERE id = $${i}`,
      values,
    );
  }
  return fetchPublicAssignment(assignmentId);
}

/** Delete an assignment the user owns (its grade cascades). */
export async function deleteAssignment(userId, assignmentId) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  await query('DELETE FROM assignments WHERE id = $1', [assignmentId]);
}

/** List a class's assignments (with any grade), ordered by due date. */
export async function listAssignments(userId, classId) {
  await getOwnedClass(userId, classId); // 404s if not owned

  const { rows } = await query(
    `SELECT a.*,
            g.id AS grade_id, g.points_earned, g.points_possible,
            g.feedback, g.graded_at
     FROM assignments a
     LEFT JOIN grades g ON g.assignment_id = a.id
     WHERE a.class_id = $1
     ORDER BY a.due_date NULLS LAST, a.created_at`,
    [classId],
  );
  return rows.map(toPublicAssignment);
}

/** Kanban WIP limit: how many of a class's assignments may be in-flight. */
export const WIP_LIMIT = 3;
// Both non-Done columns count toward the limit.
const IN_FLIGHT = ['planning', 'in_progress'];

/**
 * Move an assignment to a Kanban stage. Entering an in-flight column
 * (`planning`/`in_progress`) is blocked (409) when it would exceed the class's
 * WIP limit of in-flight cards.
 */
export async function setAssignmentStage(userId, assignmentId, stage) {
  const row = await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  if (!['planning', 'in_progress', 'done'].includes(stage)) {
    throw AppError.badRequest('Invalid stage.');
  }
  // Only enforce WIP when moving INTO an in-flight column from outside it.
  if (IN_FLIGHT.includes(stage) && !IN_FLIGHT.includes(row.stage)) {
    const { rows: cnt } = await query(
      `SELECT count(*)::int AS n FROM assignments
        WHERE class_id = $1 AND stage = ANY($2) AND id <> $3`,
      [row.class_id, IN_FLIGHT, assignmentId],
    );
    if (cnt[0].n >= WIP_LIMIT) {
      throw new AppError(409, `You have ${WIP_LIMIT}/${WIP_LIMIT} active. Pause or complete one first.`, {
        code: 'wip_limit',
      });
    }
  }
  // Stamp completion time on the first move to Done; clear it when reopened.
  const completedClause = stage === 'done'
    ? ', completed_at = COALESCE(completed_at, now())'
    : ', completed_at = NULL';
  await query(`UPDATE assignments SET stage = $1::assignment_stage${completedClause} WHERE id = $2`, [stage, assignmentId]);
  return fetchPublicAssignment(assignmentId);
}

/** List a class's in-flight count + limit (for the board's WIP badge). */
export async function assignmentWip(userId, classId) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM assignments WHERE class_id = $1 AND stage = ANY($2)`,
    [classId, IN_FLIGHT],
  );
  return { active: rows[0].n, limit: WIP_LIMIT };
}

/** Submission files attached to an assignment (class_files tagged with its id). */
export async function listAssignmentFiles(userId, assignmentId) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  const { rows } = await query(
    `SELECT id, filename, mime_type, category, size_bytes, uploaded_at
       FROM class_files WHERE assignment_id = $1 ORDER BY uploaded_at DESC`,
    [assignmentId],
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    uploadedAt: r.uploaded_at,
    downloadUrl: `/api/files/${r.id}/download`,
  }));
}
