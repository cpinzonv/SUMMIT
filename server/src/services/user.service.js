import { query } from '../config/db.js';

/**
 * Merge a partial preferences object into the user's stored preferences and
 * return the merged result. Validation happens in the controller (zod).
 */
export async function updatePreferences(userId, prefs) {
  const { rows } = await query(
    `UPDATE users
     SET preferences = COALESCE(preferences, '{}'::jsonb) || $2::jsonb
     WHERE id = $1
     RETURNING preferences`,
    [userId, JSON.stringify(prefs)],
  );
  return rows[0]?.preferences ?? {};
}

/** Read the user's stored preferences (JSONB), or {} if none. */
export async function getPreferences(userId) {
  const { rows } = await query(`SELECT preferences FROM users WHERE id = $1`, [userId]);
  return rows[0]?.preferences ?? {};
}

/** Read the user's graduation requirements. */
export async function getGraduationSettings(userId) {
  const { rows } = await query(
    `SELECT graduation_credits, semester_credits FROM users WHERE id = $1`,
    [userId],
  );
  return {
    graduationCredits: rows[0]?.graduation_credits ?? 120,
    semesterCredits: rows[0]?.semester_credits ?? null,
  };
}

/**
 * Update the user's graduation requirements. `graduationCredits` is required;
 * `semesterCredits` is optional and may be null to clear it. Validation
 * (positive integers) happens in the controller (zod).
 */
export async function updateGraduationSettings(userId, { graduationCredits, semesterCredits }) {
  const { rows } = await query(
    `UPDATE users
        SET graduation_credits = $2,
            semester_credits    = $3
      WHERE id = $1
      RETURNING graduation_credits, semester_credits`,
    [userId, graduationCredits, semesterCredits ?? null],
  );
  return {
    graduationCredits: rows[0]?.graduation_credits ?? 120,
    semesterCredits: rows[0]?.semester_credits ?? null,
  };
}
