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
