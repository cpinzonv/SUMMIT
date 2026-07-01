/**
 * CanvasSyncService — pulls Canvas assignments and grades INTO Summit's tables
 * (read-only mirror; nothing flows back to Canvas). Every run is recorded in
 * canvas_sync_logs for monitoring (count, errors, duration, status).
 *
 * Resilience: a single bad assignment/submission is logged and skipped, never
 * failing the whole run. Canvas rate limits are respected by the CanvasClient's
 * per-host throttle; this service adds a small courtesy delay between item
 * writes when volume is high.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getCanvasClient } from './lmsCredentials.service.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Coerce a Canvas points value to a number or null. */
function num(v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
}

export class CanvasSyncService {
  /** Record a sync run for monitoring. Never throws (best-effort logging). */
  async #log({ classId, kind, status, synced = 0, errors = 0, durationMs, message, triggeredBy = 'manual' }) {
    try {
      await query(
        `INSERT INTO canvas_sync_logs
           (class_id, kind, status, synced_count, error_count, duration_ms, message, triggered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [classId, kind, status, synced, errors, durationMs ?? null, message ?? null, triggeredBy],
      );
    } catch (err) {
      console.error('[canvas-sync] failed to write sync log:', err.message);
    }
  }

  /**
   * Sync all assignments for a class linked to Canvas. Upserts by
   * canvas_assignment_id, refreshing synced_at; assignments that vanished from
   * Canvas are soft-archived (archived_at set), never hard-deleted.
   * @returns {Promise<{synced:number, errors:number, archived:number}>}
   */
  async syncAssignmentsForClass(classId, { triggeredBy = 'manual' } = {}) {
    const started = Date.now();
    const cls = await this.#getLinkedClass(classId);
    const courseId = cls.linked_lms_course_id;

    let assignments;
    try {
      const client = await getCanvasClient();
      assignments = await client.getAssignments(courseId);
    } catch (err) {
      await this.#log({
        classId, kind: 'assignments', status: 'error', durationMs: Date.now() - started,
        message: err.message, triggeredBy,
      });
      throw err; // surfaced to the manual caller; the cron job catches per-class
    }

    let synced = 0;
    let errors = 0;
    const seen = [];
    for (const a of assignments) {
      try {
        await query(
          `INSERT INTO canvas_synced_assignments
             (class_id, canvas_course_id, canvas_assignment_id, name, description, due_date, points_possible, synced_at, archived_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now(), NULL)
           ON CONFLICT (canvas_assignment_id) DO UPDATE
             SET name = EXCLUDED.name,
                 description = EXCLUDED.description,
                 due_date = EXCLUDED.due_date,
                 points_possible = EXCLUDED.points_possible,
                 class_id = EXCLUDED.class_id,
                 canvas_course_id = EXCLUDED.canvas_course_id,
                 archived_at = NULL,
                 synced_at = now()`,
          [classId, String(courseId), String(a.id), a.name ?? 'Untitled assignment',
            a.description ?? null, a.due_at ?? null, num(a.points_possible)],
        );
        seen.push(String(a.id));
        synced += 1;
        if (assignments.length > 50) await sleep(10); // courtesy pacing for big courses
      } catch (err) {
        errors += 1;
        console.error(`[canvas-sync] assignment ${a?.id} failed for class ${classId}:`, err.message);
      }
    }

    // Soft-archive anything we have for this class that Canvas no longer returns.
    let archived = 0;
    try {
      const params = [classId];
      let notIn = '';
      if (seen.length) {
        notIn = ` AND canvas_assignment_id <> ALL($2)`;
        params.push(seen);
      }
      const { rowCount } = await query(
        `UPDATE canvas_synced_assignments
           SET archived_at = now()
         WHERE class_id = $1 AND archived_at IS NULL${notIn}`,
        params,
      );
      archived = rowCount;
    } catch (err) {
      console.error(`[canvas-sync] archive sweep failed for class ${classId}:`, err.message);
    }

    await this.#log({
      classId, kind: 'assignments', status: 'success', synced, errors,
      durationMs: Date.now() - started,
      message: `synced ${synced}, archived ${archived}, errors ${errors}`,
      triggeredBy,
    });
    console.info(`[canvas-sync] class ${classId}: ${synced} assignments synced, ${archived} archived, ${errors} errors`);
    return { synced, errors, archived };
  }

  /**
   * Sync per-assignment grades/submissions for a user in a Canvas-linked class.
   * Uses the Canvas submissions endpoint scoped to `self` (the token owner) by
   * default — per-user lookup by email requires account-admin permissions the
   * personal token doesn't have. Upserts by (user_id, canvas_assignment_id).
   * @returns {Promise<{synced:number, errors:number}>}
   */
  async syncGradesForUser(userId, classId, { triggeredBy = 'manual', canvasStudentId = 'self' } = {}) {
    const started = Date.now();
    const cls = await this.#getLinkedClass(classId);

    let submissions;
    try {
      const client = await getCanvasClient();
      submissions = await client.getSubmissions(cls.linked_lms_course_id, canvasStudentId);
    } catch (err) {
      await this.#log({
        classId, kind: 'grades', status: 'error', durationMs: Date.now() - started,
        message: err.message, triggeredBy,
      });
      throw err;
    }

    let synced = 0;
    let errors = 0;
    for (const s of submissions) {
      try {
        await query(
          `INSERT INTO canvas_synced_grades
             (user_id, class_id, canvas_assignment_id, score, max_points, submitted_at, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6, now())
           ON CONFLICT (user_id, canvas_assignment_id) DO UPDATE
             SET score = EXCLUDED.score,
                 max_points = EXCLUDED.max_points,
                 submitted_at = EXCLUDED.submitted_at,
                 class_id = EXCLUDED.class_id,
                 synced_at = now()`,
          [userId, classId, String(s.assignment_id), num(s.score),
            num(s.assignment?.points_possible), s.submitted_at ?? null],
        );
        synced += 1;
      } catch (err) {
        errors += 1;
        console.error(`[canvas-sync] grade for assignment ${s?.assignment_id} failed (user ${userId}):`, err.message);
      }
    }

    await this.#log({
      classId, kind: 'grades', status: 'success', synced, errors,
      durationMs: Date.now() - started,
      message: `synced ${synced} grades for user ${userId}, errors ${errors}`,
      triggeredBy,
    });
    console.info(`[canvas-sync] user ${userId} class ${classId}: ${synced} grades synced, ${errors} errors`);
    return { synced, errors };
  }

  /** Load a class row and assert it's linked to Canvas. */
  async #getLinkedClass(classId) {
    const { rows } = await query(
      'SELECT id, user_id, linked_lms, linked_lms_course_id FROM classes WHERE id = $1',
      [classId],
    );
    const cls = rows[0];
    if (!cls) throw AppError.notFound('Class not found');
    if (cls.linked_lms !== 'canvas' || !cls.linked_lms_course_id) {
      throw AppError.badRequest('This class is not linked to a Canvas course.');
    }
    return cls;
  }
}

export const canvasSync = new CanvasSyncService();
