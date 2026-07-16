import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { createFile, deleteFile, renameFile, listAssignmentFiles } from './file.service.js';
import { estimateMinutes } from './estimate.service.js';

function toPublicAssignment(row) {
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    description: row.description,
    instructions: row.instructions ?? null,      // rich HTML (detail modal), separate from description
    workingContent: row.working_content ?? null, // Working-tab HTML (autosaved)
    workingSavedAt: row.working_saved_at ?? null,
    category: row.category,
    dueDate: row.due_date,
    plannedDate: row.planned_date,
    scheduledTime: row.scheduled_time ?? null, // time-blocking (Schedule tab); null until set
    pointValue: row.point_value == null ? null : Number(row.point_value),
    estimatedHours: row.estimated_hours == null ? null : Number(row.estimated_hours),
    estimateSource: row.estimate_source ?? null, // 'manual' | 'ai' | 'default' | null
    status: row.status,
    boardStage: row.board_stage ?? 'not_started', // shared Kanban stage (To-Do + class boards)
    priority: row.priority ?? 'none',
    externalSource: row.external_source ?? null, // 'canvas' if synced from an LMS
    submission:
      row.submitted_at || row.submission_text || row.submission_file_id
        ? {
            text: row.submission_text ?? null,
            submittedAt: row.submitted_at ?? null,
            file: row.submission_file_id
              ? { id: row.submission_file_id, filename: row.submission_file_name ?? 'attachment' }
              : null,
          }
        : null,
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
            g.feedback, g.graded_at,
            sf.filename AS submission_file_name
     FROM assignments a
     LEFT JOIN grades g ON g.assignment_id = a.id
     LEFT JOIN class_files sf ON sf.id = a.submission_file_id
     WHERE a.id = $1`,
    [assignmentId],
  );
  return rows[0] ? toPublicAssignment(rows[0]) : null;
}

/** Fetch one assignment (with grade + submission), owner-scoped, in the API shape. */
export async function getAssignmentForUser(userId, assignmentId) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  return fetchPublicAssignment(assignmentId);
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

  // A brand-new assignment has no instructions for the AI to work with, so give
  // it a 1h DEFAULT estimate — workload math and the Schedule tray always have a
  // duration. Tagged 'default' so a later AI run or manual edit overrides it
  // cleanly. An estimate supplied at creation is treated as a manual entry.
  const estimatedHours = input.estimatedHours != null ? input.estimatedHours : 1;
  const estimateSource = input.estimatedHours != null ? 'manual' : 'default';

  const { rows } = await query(
    `INSERT INTO assignments
       (class_id, title, description, category, due_date, planned_date,
        point_value, status, priority, estimated_hours, scheduled_time, estimate_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
             COALESCE($8::assignment_status, 'not_started'),
             COALESCE($9::assignment_priority, 'none'),
             $10,$11,$12)
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
      estimatedHours,
      input.scheduledTime ?? null,
      estimateSource,
    ],
  );
  return fetchPublicAssignment(rows[0].id);
}

// API field -> column mapping for partial updates.
const UPDATABLE = {
  title: 'title',
  description: 'description',
  instructions: 'instructions',
  workingContent: 'working_content',
  category: 'category',
  dueDate: 'due_date',
  plannedDate: 'planned_date',
  scheduledTime: 'scheduled_time',
  pointValue: 'point_value',
  status: 'status',
  priority: 'priority',
  estimatedHours: 'estimated_hours',
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

  // Stamp the Working-tab save time whenever its content changes.
  if ('workingContent' in input) sets.push('working_saved_at = now()');

  // A user editing the estimate directly marks it 'manual' — AI re-estimation
  // then leaves it alone. Clearing the estimate clears the source too.
  if ('estimatedHours' in input) {
    sets.push(`estimate_source = $${i}`);
    values.push(input.estimatedHours == null ? null : 'manual');
    i += 1;
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
            g.feedback, g.graded_at,
            sf.filename AS submission_file_name
     FROM assignments a
     LEFT JOIN grades g ON g.assignment_id = a.id
     LEFT JOIN class_files sf ON sf.id = a.submission_file_id
     WHERE a.class_id = $1
     ORDER BY a.due_date NULLS LAST, a.created_at`,
    [classId],
  );
  return rows.map(toPublicAssignment);
}

/**
 * Submit (or update a submission for) an assignment: optional text + an optional
 * file (stored in class_files under the assignment's class). Stamps submitted_at
 * and marks the assignment 'submitted'. Passing a new file replaces the old one.
 */
export async function submitAssignment(userId, assignmentId, { text, file } = {}) {
  const a = await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  let fileId = a.submission_file_id;
  if (file) {
    const stored = await createFile(userId, a.class_id, file, 'submission');
    if (a.submission_file_id) await deleteFile(userId, a.submission_file_id).catch(() => {});
    fileId = stored.id;
  }
  await query(
    `UPDATE assignments
        SET submission_text = $1, submission_file_id = $2, submitted_at = now(),
            status = 'submitted'
      WHERE id = $3`,
    [text ?? null, fileId, assignmentId],
  );
  return fetchPublicAssignment(assignmentId);
}

/** Withdraw a submission: clear text/file/timestamp and reopen (in progress). */
export async function clearSubmission(userId, assignmentId) {
  const a = await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  if (a.submission_file_id) await deleteFile(userId, a.submission_file_id).catch(() => {});
  await query(
    `UPDATE assignments
        SET submission_text = NULL, submission_file_id = NULL, submitted_at = NULL,
            status = 'in_progress'
      WHERE id = $1`,
    [assignmentId],
  );
  return fetchPublicAssignment(assignmentId);
}

/* ------------------------------------------------ Detail modal: AI estimate */

/** Estimate the assignment's duration with Claude and persist it (decimal hours). */
export async function estimateTime(userId, assignmentId, instructions) {
  const a = await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  // A manual estimate is authoritative — never let AI overwrite it.
  if (a.estimate_source === 'manual') {
    const hours = a.estimated_hours == null ? null : Number(a.estimated_hours);
    return { minutes: hours == null ? null : Math.round(hours * 60), estimatedHours: hours, source: 'manual', kept: true };
  }
  const { minutes } = await estimateMinutes({ title: a.title, instructions: instructions ?? a.instructions });
  const hours = Math.round((minutes / 60) * 100) / 100; // 2 dp, matches NUMERIC(5,2)
  await query('UPDATE assignments SET estimated_hours = $1, estimate_source = $2 WHERE id = $3', [hours, 'ai', assignmentId]);
  return { minutes, estimatedHours: hours, source: 'ai' };
}

/* --------------------------------------------- Detail modal: instruction files */

/** List the instruction files uploaded to an assignment. */
export async function listInstructionFiles(userId, assignmentId) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  return listAssignmentFiles(userId, assignmentId, 'assignment_instructions');
}

/** Attach an uploaded instruction file to an assignment. */
export async function addInstructionFile(userId, assignmentId, file) {
  const a = await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  return createFile(userId, a.class_id, file, 'assignment_instructions', assignmentId);
}

/** Rename an instruction file (ownership enforced via the file's class). */
export async function renameInstructionFile(userId, assignmentId, fileId, filename) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  return renameFile(userId, fileId, filename);
}

/** Delete an instruction file. */
export async function deleteInstructionFile(userId, assignmentId, fileId) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  await deleteFile(userId, fileId);
}

/* ------------------------------------------- Detail modal: submission history */

function toPublicSubmission(row) {
  return {
    id: row.id,
    kind: row.kind, // 'file' | 'link' | 'working'
    text: row.text ?? null,
    url: row.url ?? null,
    file: row.file_id ? { id: row.file_id, filename: row.file_name ?? 'attachment' } : null,
    createdAt: row.created_at,
  };
}

/** Full submission history for an assignment, newest first. */
export async function listSubmissions(userId, assignmentId) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  const { rows } = await query(
    `SELECT s.*, f.filename AS file_name
       FROM assignment_submissions s
       LEFT JOIN class_files f ON f.id = s.file_id
      WHERE s.assignment_id = $1
      ORDER BY s.created_at DESC`,
    [assignmentId],
  );
  return rows.map(toPublicSubmission);
}

/**
 * Record a new submission of one kind:
 *   'file'    → an uploaded file (multer buffer)
 *   'link'    → an external URL (Google Doc, etc.)
 *   'working' → a snapshot of the Working-tab HTML (passed as text)
 * Also stamps the assignment as submitted so the card/table badge updates.
 */
export async function addSubmission(userId, assignmentId, { kind, text, url, file } = {}) {
  const a = await getOwnedAssignment(userId, assignmentId); // 404s if not owned

  let fileId = null;
  if (kind === 'file') {
    if (!file) throw AppError.badRequest('Attach a file to submit.');
    const stored = await createFile(userId, a.class_id, file, 'submission', assignmentId);
    fileId = stored.id;
  } else if (kind === 'link') {
    if (!url || !/^https?:\/\//i.test(url)) throw AppError.badRequest('Enter a valid link (starting with http).');
  } else if (kind === 'working') {
    if (!text || !text.trim()) throw AppError.badRequest('There is nothing in your Working tab to submit yet.');
  } else {
    throw AppError.badRequest('Unknown submission type.');
  }

  const { rows } = await query(
    `INSERT INTO assignment_submissions (assignment_id, kind, text, url, file_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [assignmentId, kind, text ?? null, url ?? null, fileId],
  );
  // Mark submitted so existing badges (card/table) reflect it.
  await query("UPDATE assignments SET submitted_at = now(), status = 'submitted' WHERE id = $1", [assignmentId]);

  const withName = (await query(
    `SELECT s.*, f.filename AS file_name FROM assignment_submissions s
       LEFT JOIN class_files f ON f.id = s.file_id WHERE s.id = $1`,
    [rows[0].id],
  )).rows[0];
  return toPublicSubmission(withName);
}

/** Delete a single submission from the history (and its file, if any). */
export async function deleteSubmission(userId, assignmentId, submissionId) {
  await getOwnedAssignment(userId, assignmentId); // 404s if not owned
  const { rows } = await query(
    'SELECT file_id FROM assignment_submissions WHERE id = $1 AND assignment_id = $2',
    [submissionId, assignmentId],
  );
  if (!rows[0]) throw AppError.notFound('Submission not found');
  await query('DELETE FROM assignment_submissions WHERE id = $1', [submissionId]);
  if (rows[0].file_id) await deleteFile(userId, rows[0].file_id).catch(() => {});

  // If no submissions remain, clear the submitted stamp so the badge disappears.
  const { rows: remaining } = await query(
    'SELECT 1 FROM assignment_submissions WHERE assignment_id = $1 LIMIT 1',
    [assignmentId],
  );
  if (!remaining[0]) {
    await query("UPDATE assignments SET submitted_at = NULL WHERE id = $1 AND status = 'submitted'", [assignmentId]);
  }
}
