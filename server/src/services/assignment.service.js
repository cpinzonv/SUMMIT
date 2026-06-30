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
    status: row.status,
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
        point_value, status, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
             COALESCE($8::assignment_status, 'not_started'),
             COALESCE($9::assignment_priority, 'none'))
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
