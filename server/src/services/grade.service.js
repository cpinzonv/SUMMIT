import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { summarizeGrade } from '../utils/grade.js';

/**
 * Compute a class's current grade from the point totals of its graded
 * assignments. `db` may be a transaction client.
 */
export async function computeClassGrade(classId, db = { query }) {
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(g.points_earned), 0)   AS earned,
       COALESCE(SUM(g.points_possible), 0) AS possible,
       COUNT(g.id)                         AS graded
     FROM assignments a
     JOIN grades g ON g.assignment_id = a.id
     WHERE a.class_id = $1`,
    [classId],
  );
  const { earned, possible, graded } = rows[0];
  return summarizeGrade(Number(earned), Number(possible), Number(graded));
}

function toPublicGrade(row) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    pointsEarned: Number(row.points_earned),
    pointsPossible: Number(row.points_possible),
    feedback: row.feedback,
    gradedAt: row.graded_at,
  };
}

/**
 * Submit (or update) the grade for an assignment, then recompute the owning
 * class's current grade. points_possible defaults to the assignment's
 * point_value when not supplied. Verifies the assignment belongs to the user.
 */
export async function submitGrade(userId, input) {
  return withTransaction(async (client) => {
    // Ownership + fetch the assignment (and its class) in one guarded query.
    const { rows: aRows } = await client.query(
      `SELECT a.id, a.class_id, a.point_value
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       WHERE a.id = $1 AND c.user_id = $2`,
      [input.assignmentId, userId],
    );
    const assignment = aRows[0];
    if (!assignment) throw AppError.notFound('Assignment not found');

    const pointsPossible =
      input.pointsPossible ??
      (assignment.point_value != null ? Number(assignment.point_value) : null);

    if (pointsPossible == null) {
      throw AppError.badRequest(
        'pointsPossible is required because the assignment has no point_value',
      );
    }
    if (pointsPossible <= 0) {
      throw AppError.badRequest('pointsPossible must be greater than 0');
    }

    // One grade per assignment — upsert on the unique assignment_id.
    const { rows: gRows } = await client.query(
      `INSERT INTO grades (assignment_id, points_earned, points_possible, feedback)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assignment_id) DO UPDATE
         SET points_earned   = EXCLUDED.points_earned,
             points_possible = EXCLUDED.points_possible,
             feedback        = EXCLUDED.feedback,
             graded_at       = now()
       RETURNING *`,
      [input.assignmentId, input.pointsEarned, pointsPossible, input.feedback ?? null],
    );

    // Recording a grade marks the assignment graded.
    await client.query(
      `UPDATE assignments SET status = 'graded' WHERE id = $1`,
      [input.assignmentId],
    );

    const classGrade = await computeClassGrade(assignment.class_id, client);

    return {
      grade: toPublicGrade(gRows[0]),
      classId: assignment.class_id,
      classGrade,
    };
  });
}
