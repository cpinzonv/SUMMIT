/**
 * Spaced-repetition engine + learning analytics for the Learn tab.
 *
 * card_reviews is the source of truth: each review stores the SM-2 state AFTER
 * it (interval, ease, next_review_at), so the latest row per card is its current
 * schedule. mastery_levels, learning_streaks and user_learning_stats cache
 * derived state for fast dashboards and are updated on each review.
 */
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedCard } from './flashcard.service.js';

// ---- SM-2 ------------------------------------------------------------------

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;

/**
 * Compute the next SM-2 schedule from the previous state and a 1–5 confidence.
 * Confidence maps directly to SM-2 quality q; q < 3 is a lapse (relearn at 1d).
 * @returns {{ intervalDays:number, easeFactor:number, correct:boolean }}
 */
export function computeSm2({ confidence, prevInterval = 0, prevEase = DEFAULT_EASE }) {
  const q = Math.max(0, Math.min(5, confidence));
  const correct = q >= 3;

  // Ease update (standard SM-2 formula), floored at 1.3.
  let ease = prevEase + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ease = Math.max(MIN_EASE, Math.round(ease * 100) / 100);

  let intervalDays;
  if (!correct) {
    intervalDays = 1; // lapsed → relearn tomorrow
  } else if (prevInterval <= 0) {
    intervalDays = 1; // first successful review
  } else if (prevInterval === 1) {
    intervalDays = 6; // second
  } else {
    intervalDays = Math.round(prevInterval * ease);
  }
  return { intervalDays, easeFactor: ease, correct };
}

/** Derive a card's mastery status + a 0–100 progress percent. */
function deriveMastery({ correctCount, intervalDays, confidenceAverage }) {
  let status;
  if (correctCount === 0) status = 'new';
  else if (correctCount < 3) status = 'learning';
  else if (intervalDays >= 21 && (confidenceAverage ?? 0) >= 4) status = 'mastered';
  else status = 'review';

  // Interval contributes up to 60, average confidence up to 40.
  const intervalPart = Math.min(intervalDays, 21) / 21 * 60;
  const confPart = confidenceAverage ? (confidenceAverage / 5) * 40 : 0;
  const masteryPercent = status === 'new' ? 0 : Math.min(100, Math.round(intervalPart + confPart));
  return { status, masteryPercent };
}

// ---- Streaks ---------------------------------------------------------------

/** Advance a (user, class|global) streak for "studied today". Runs in a txn client. */
async function bumpStreak(client, userId, classId) {
  const isGlobal = classId == null;
  const where = isGlobal ? 'user_id = $1 AND class_id IS NULL' : 'user_id = $1 AND class_id = $2';
  const params = isGlobal ? [userId] : [userId, classId];
  const { rows } = await client.query(`SELECT * FROM learning_streaks WHERE ${where}`, params);
  const row = rows[0];

  if (!row) {
    await client.query(
      `INSERT INTO learning_streaks (user_id, class_id, current_streak, longest_streak, last_reviewed_at, reviews_today)
       VALUES ($1, $2, 1, 1, CURRENT_DATE, 1)`,
      [userId, classId],
    );
    return;
  }

  // Days between last_reviewed_at and today (NULL last → treat as a fresh start).
  const { rows: d } = await client.query(
    `SELECT (CURRENT_DATE - $1::date) AS gap`,
    [row.last_reviewed_at],
  );
  const gap = row.last_reviewed_at == null ? null : Number(d[0].gap);

  let current = row.current_streak;
  let reviewsToday = row.reviews_today;
  if (gap === 0) {
    reviewsToday += 1; // already studied today — streak unchanged
  } else if (gap === 1) {
    current += 1;
    reviewsToday = 1;
  } else {
    current = 1; // missed a day (or first ever) → reset
    reviewsToday = 1;
  }
  const longest = Math.max(row.longest_streak, current);
  await client.query(
    `UPDATE learning_streaks
        SET current_streak = $1, longest_streak = $2, reviews_today = $3, last_reviewed_at = CURRENT_DATE
      WHERE id = $4`,
    [current, longest, reviewsToday, row.id],
  );
}

// ---- Review ----------------------------------------------------------------

/**
 * Record a review of a card: compute the SM-2 schedule, log it, and update the
 * card's mastery, the user's streaks, and (optionally) the active session.
 */
export async function reviewCard(userId, cardId, { confidence, timeSpentSeconds, sessionId }) {
  const card = await getOwnedCard(userId, cardId); // 404s if not owned

  return withTransaction(async (client) => {
    // Previous schedule = latest review for this card.
    const { rows: prevRows } = await client.query(
      `SELECT interval_days, ease_factor FROM card_reviews
        WHERE card_id = $1 ORDER BY reviewed_at DESC LIMIT 1`,
      [cardId],
    );
    const prev = prevRows[0];
    const { intervalDays, easeFactor, correct } = computeSm2({
      confidence,
      prevInterval: prev?.interval_days ?? 0,
      prevEase: prev?.ease_factor != null ? Number(prev.ease_factor) : DEFAULT_EASE,
    });

    const { rows: reviewRows } = await client.query(
      `INSERT INTO card_reviews
         (user_id, card_id, time_spent_seconds, confidence, correct,
          interval_days, ease_factor, next_review_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(days => $6))
       RETURNING *`,
      [userId, cardId, timeSpentSeconds ?? null, confidence, correct, intervalDays, easeFactor],
    );
    const review = reviewRows[0];

    // Upsert mastery_levels (recompute aggregates).
    const { rows: mRows } = await client.query(
      `SELECT * FROM mastery_levels WHERE card_id = $1 AND user_id = $2`,
      [cardId, userId],
    );
    const m = mRows[0];
    const totalReviews = (m?.total_reviews ?? 0) + 1;
    const correctCount = (m?.correct_count ?? 0) + (correct ? 1 : 0);
    const prevAvg = m?.confidence_average != null ? Number(m.confidence_average) : null;
    const confidenceAverage =
      prevAvg == null
        ? confidence
        : Math.round(((prevAvg * (totalReviews - 1) + confidence) / totalReviews) * 100) / 100;
    const { status, masteryPercent } = deriveMastery({ correctCount, intervalDays, confidenceAverage });

    if (m) {
      await client.query(
        `UPDATE mastery_levels
            SET status = $1, correct_count = $2, total_reviews = $3,
                confidence_average = $4, mastery_percent = $5
          WHERE id = $6`,
        [status, correctCount, totalReviews, confidenceAverage, masteryPercent, m.id],
      );
    } else {
      await client.query(
        `INSERT INTO mastery_levels
           (card_id, user_id, status, correct_count, total_reviews, confidence_average, mastery_percent)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cardId, userId, status, correctCount, totalReviews, confidenceAverage, masteryPercent],
      );
    }

    // Streaks: global + this card's class.
    await bumpStreak(client, userId, null);
    await bumpStreak(client, userId, card.class_id);

    // Session running totals (if a session is active and owned by the user).
    if (sessionId) {
      await client.query(
        `UPDATE learning_sessions
            SET cards_reviewed = cards_reviewed + 1,
                cards_mastered = cards_mastered + $1
          WHERE id = $2 AND user_id = $3`,
        [status === 'mastered' ? 1 : 0, sessionId, userId],
      );
    }

    return {
      review: {
        id: review.id,
        cardId,
        confidence,
        correct,
        intervalDays,
        easeFactor: Number(easeFactor),
        nextReviewAt: review.next_review_at,
      },
      mastery: { status, masteryPercent, totalReviews, correctCount },
    };
  });
}

// ---- Due queue -------------------------------------------------------------

/** Cards due for review (never-reviewed cards are always due). Optional class filter. */
export async function getDueCards(userId, { classId = null, limit = 50 } = {}) {
  const params = [userId];
  let classFilter = '';
  if (classId) {
    params.push(classId);
    classFilter = `AND f.class_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(limit, 1), 200));
  const { rows } = await query(
    `SELECT f.*, c.name AS class_name,
            lr.next_review_at,
            m.status AS mastery_status, m.mastery_percent, m.total_reviews
       FROM flashcards f
       JOIN classes c ON c.id = f.class_id
       LEFT JOIN mastery_levels m ON m.card_id = f.id AND m.user_id = f.user_id
       LEFT JOIN LATERAL (
         SELECT next_review_at FROM card_reviews r
          WHERE r.card_id = f.id ORDER BY reviewed_at DESC LIMIT 1
       ) lr ON true
      WHERE f.user_id = $1 ${classFilter}
        AND (lr.next_review_at IS NULL OR lr.next_review_at <= now())
      ORDER BY lr.next_review_at ASC NULLS FIRST
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
