import { query } from '../config/db.js';

/** List the user's archived classes (the point-in-time snapshots), newest first. */
export async function listArchives(userId) {
  const { rows } = await query(
    `SELECT id, entity_type, entity_id, label, snapshot, archived_at
     FROM archives
     WHERE user_id = $1 AND entity_type = 'class'
     ORDER BY archived_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    classId: row.entity_id,
    label: row.label,
    archivedAt: row.archived_at,
    snapshot: row.snapshot,
  }));
}
