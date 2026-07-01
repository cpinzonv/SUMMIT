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

/**
 * Cards due for study, keyed off the classic-SM-2 schedule on the flashcards
 * row: a card is due when it's new (next_review_date IS NULL) or its review
 * date has arrived — and it isn't suspended/buried. Optional class/deck filter.
 */
export async function getDueCards(userId, { classId = null, deckId = null, limit = 50 } = {}) {
  const params = [userId];
  let filter = '';
  if (classId) {
    params.push(classId);
    filter += ` AND f.class_id = $${params.length}`;
  }
  if (deckId) {
    params.push(deckId);
    filter += ` AND f.deck_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(limit, 1), 200));
  const { rows } = await query(
    `SELECT f.*, c.name AS class_name
       FROM flashcards f
       JOIN classes c ON c.id = f.class_id
      WHERE f.user_id = $1 ${filter}
        AND f.is_suspended = false
        AND (f.bury_until IS NULL OR f.bury_until <= now())
        AND (f.next_review_date IS NULL OR f.next_review_date <= now())
      ORDER BY f.next_review_date ASC NULLS FIRST
      LIMIT $${params.length}`,
    params,
  );
  return rows;
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

/**
 * Aggregate the user's learning stats and refresh the cached row. All the
 * scheduling-derived numbers come from the SM-2 state on the flashcards row;
 * the streak is derived from the card_reviews history (distinct study days).
 * Buckets by interval: new (unstudied) · learning (<7d) · review (7–20d) ·
 * mastered (≥21d).
 */
export async function getOverview(userId) {
  const [{ rows: aggRows }, { rows: dayRows }, { rows: sessRows }] = await Promise.all([
    query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE next_review_date IS NULL)::int AS new_cards,
         count(*) FILTER (WHERE next_review_date IS NOT NULL AND sm2_interval < 7)::int AS learning_cards,
         count(*) FILTER (WHERE sm2_interval >= 7 AND sm2_interval < 21)::int AS review_cards,
         count(*) FILTER (WHERE sm2_interval >= 21)::int AS mastered_cards,
         count(*) FILTER (
           WHERE is_suspended = false
             AND (bury_until IS NULL OR bury_until <= now())
             AND (next_review_date IS NULL OR next_review_date <= now())
         )::int AS due_today,
         COALESCE(round(avg(
           LEAST(100, round((LEAST(sm2_interval, 21)::numeric / 21) * 100))
         ) FILTER (WHERE next_review_date IS NOT NULL)), 0)::int AS avg_mastery
       FROM flashcards WHERE user_id = $1`,
      [userId],
    ),
    query(
      `SELECT DISTINCT reviewed_at::date AS d FROM card_reviews WHERE user_id = $1 ORDER BY d DESC`,
      [userId],
    ),
    query(
      `SELECT COALESCE(SUM(duration_minutes),0)::int AS total_minutes,
              COALESCE(ROUND(AVG(duration_minutes)),0)::int AS avg_minutes
         FROM learning_sessions WHERE user_id = $1 AND ended_at IS NOT NULL`,
      [userId],
    ),
  ]);

  const agg = aggRows[0];
  const total = agg.total;

  // Streak from distinct study days (descending). "Current" must include today
  // or yesterday; "longest" is the longest consecutive run ever.
  const dayNum = (d) => Math.floor(new Date(d).getTime() / 86400000);
  const nums = dayRows.map((r) => dayNum(r.d)); // distinct, descending
  const today = dayNum(new Date());
  let currentStreak = 0;
  let longestStreak = 0;
  if (nums.length) {
    if (nums[0] === today || nums[0] === today - 1) {
      currentStreak = 1;
      for (let i = 1; i < nums.length; i++) {
        if (nums[i] === nums[i - 1] - 1) currentStreak += 1;
        else break;
      }
    }
    let run = 1;
    longestStreak = 1;
    for (let i = 1; i < nums.length; i++) {
      run = nums[i] === nums[i - 1] - 1 ? run + 1 : 1;
      if (run > longestStreak) longestStreak = run;
    }
  }

  const totalStudyHours = Math.round((sessRows[0].total_minutes / 60) * 100) / 100;

  const overview = {
    totalCards: total,
    newCards: agg.new_cards,
    learningCards: agg.learning_cards,
    reviewCards: agg.review_cards,
    masteredCards: agg.mastered_cards,
    dueToday: agg.due_today,
    currentStreak,
    longestStreak,
    averageMasteryPercent: agg.avg_mastery,
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
      agg.mastered_cards,
      agg.learning_cards,
      agg.new_cards,
      currentStreak,
      longestStreak,
      totalStudyHours,
      sessRows[0].avg_minutes,
      agg.avg_mastery,
    ],
  );

  return overview;
}
