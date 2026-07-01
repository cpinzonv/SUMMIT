/**
 * Due-queue, study sessions, and learning analytics for the Learn tab.
 *
 * Card scheduling now uses classic SM-2 stored on the flashcards row (see
 * sm2.service.js / deckStudy.service.js). card_reviews remains an append-only
 * history log that these aggregate reads draw from.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

// ---- Due queue -------------------------------------------------------------

/** Cards due for review (never-reviewed cards are always due). Optional class filter. */
export async function getDueCards(userId, { classId = null, deckId = null, limit = 50 } = {}) {
  const params = [userId];
  let classFilter = '';
  if (classId) {
    params.push(classId);
    classFilter = `AND f.class_id = $${params.length}`;
  }
  if (deckId) {
    params.push(deckId);
    classFilter += ` AND f.deck_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(limit, 1), 200));
  const { rows } = await query(
    `SELECT f.*, c.name AS class_name,
            lr.next_review_at, lr.phase, lr.learning_step, lr.lapses,
            m.status AS mastery_status, m.mastery_percent, m.total_reviews
       FROM flashcards f
       JOIN classes c ON c.id = f.class_id
       LEFT JOIN mastery_levels m ON m.card_id = f.id AND m.user_id = f.user_id
       LEFT JOIN LATERAL (
         SELECT next_review_at, phase, learning_step, lapses FROM card_reviews r
          WHERE r.card_id = f.id ORDER BY reviewed_at DESC LIMIT 1
       ) lr ON true
      WHERE f.user_id = $1 ${classFilter}
        AND f.is_suspended = false
        AND (f.bury_until IS NULL OR f.bury_until <= now())
        AND (lr.next_review_at IS NULL OR lr.next_review_at <= now())
      ORDER BY lr.next_review_at ASC NULLS FIRST
      LIMIT $${params.length}`,
    params,
  );
  // New cards (no review row) default to the learning phase, step 0.
  return rows.map((r) => ({ ...r, phase: r.phase ?? 'learning', learning_step: r.learning_step ?? 0, lapses: r.lapses ?? 0 }));
}

// ---- Sessions --------------------------------------------------------------

export async function startSession(userId, classId = null) {
  const { rows } = await query(
    `INSERT INTO learning_sessions (user_id, class_id) VALUES ($1, $2) RETURNING *`,
    [userId, classId ?? null],
  );
  return rows[0];
}

export async function endSession(userId, sessionId, { averageConfidence, interruptions } = {}) {
  const { rows } = await query(
    `UPDATE learning_sessions
        SET ended_at = now(),
            duration_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - started_at)) / 60))::int,
            average_confidence = COALESCE($1, average_confidence),
            interruptions = COALESCE($2, interruptions)
      WHERE id = $3 AND user_id = $4
      RETURNING *`,
    [averageConfidence ?? null, interruptions ?? null, sessionId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Session not found');
  return rows[0];
}

// ---- Stats overview --------------------------------------------------------

/** Aggregate the user's learning stats and refresh the cached row. */
export async function getOverview(userId) {
  const [{ rows: totalRows }, { rows: statusRows }, { rows: dueRows }, { rows: streakRows }, { rows: sessRows }, { rows: avgRows }] =
    await Promise.all([
      query('SELECT count(*)::int AS n FROM flashcards WHERE user_id = $1', [userId]),
      query(
        `SELECT status, count(*)::int AS n FROM mastery_levels WHERE user_id = $1 GROUP BY status`,
        [userId],
      ),
      query(
        `SELECT count(*)::int AS n FROM flashcards f
           LEFT JOIN LATERAL (
             SELECT next_review_at FROM card_reviews r
              WHERE r.card_id = f.id ORDER BY reviewed_at DESC LIMIT 1
           ) lr ON true
          WHERE f.user_id = $1 AND (lr.next_review_at IS NULL OR lr.next_review_at <= now())`,
        [userId],
      ),
      query('SELECT current_streak, longest_streak FROM learning_streaks WHERE user_id = $1 AND class_id IS NULL', [userId]),
      query(
        `SELECT COALESCE(SUM(duration_minutes),0)::int AS total_minutes,
                COALESCE(ROUND(AVG(duration_minutes)),0)::int AS avg_minutes
           FROM learning_sessions WHERE user_id = $1 AND ended_at IS NOT NULL`,
        [userId],
      ),
      query('SELECT COALESCE(ROUND(AVG(mastery_percent)),0)::int AS avg_mastery FROM mastery_levels WHERE user_id = $1', [userId]),
    ]);

  const total = totalRows[0].n;
  const byStatus = { new: 0, learning: 0, review: 0, mastered: 0 };
  for (const r of statusRows) byStatus[r.status] = r.n;
  // Cards with no mastery row yet are effectively new, so derive "new" from the
  // total rather than the mastery rows (which only exist after a first review).
  const newCards = total - (byStatus.learning + byStatus.review + byStatus.mastered);

  const streak = streakRows[0]?.current_streak ?? 0;
  const longestStreak = streakRows[0]?.longest_streak ?? 0;
  const totalStudyHours = Math.round((sessRows[0].total_minutes / 60) * 100) / 100;

  const overview = {
    totalCards: total,
    newCards: Math.max(0, newCards),
    learningCards: byStatus.learning,
    reviewCards: byStatus.review,
    masteredCards: byStatus.mastered,
    dueToday: dueRows[0].n,
    currentStreak: streak,
    longestStreak,
    averageMasteryPercent: avgRows[0].avg_mastery,
    totalStudyHours,
    averageSessionMinutes: sessRows[0].avg_minutes,
  };

  // Refresh the cached aggregate row (best-effort; not critical to the response).
  await query(
    `INSERT INTO user_learning_stats
       (user_id, total_cards, mastered_cards, learning_cards, new_cards,
        global_streak, longest_global_streak, total_study_hours,
        average_session_minutes, average_mastery_percent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id) DO UPDATE SET
       total_cards = EXCLUDED.total_cards,
       mastered_cards = EXCLUDED.mastered_cards,
       learning_cards = EXCLUDED.learning_cards,
       new_cards = EXCLUDED.new_cards,
       global_streak = EXCLUDED.global_streak,
       longest_global_streak = EXCLUDED.longest_global_streak,
       total_study_hours = EXCLUDED.total_study_hours,
       average_session_minutes = EXCLUDED.average_session_minutes,
       average_mastery_percent = EXCLUDED.average_mastery_percent`,
    [
      userId,
      total,
      byStatus.mastered,
      byStatus.learning,
      Math.max(0, newCards),
      streak,
      longestStreak,
      totalStudyHours,
      sessRows[0].avg_minutes,
      avgRows[0].avg_mastery,
    ],
  );

  return overview;
}
