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

// ---- Anki-style 3-phase scheduler ------------------------------------------
// Ratings: 1=Again, 2=Hard, 3=Good, 4=Easy. Cards move learning → review, lapse
// to relearning on "Again" in review, then graduate back. Learning/relearning
// steps are in MINUTES (sub-day), review intervals in DAYS.

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const LEARNING_STEPS = [1, 10]; // minutes
const RELEARNING_STEPS = [10]; // minutes
const EASY_BONUS = 1.3;
const EASY_GRAD_DAYS = 4; // "Easy" graduates straight to a 4-day interval

const clampEase = (e) => Math.max(MIN_EASE, Math.round(e * 100) / 100);

/**
 * Compute the next schedule from the previous state + a 1-4 rating.
 * @returns {{ phase, learningStep, lapses, intervalDays, minutes, easeFactor, correct, graduatedToReview }}
 */
export function scheduleCard({ rating, phase = 'learning', step = 0, lapses = 0, prevInterval = 0, prevEase = DEFAULT_EASE }) {
  const r = Math.max(1, Math.min(4, rating));
  const correct = r >= 3;
  const ease = prevEase || DEFAULT_EASE;
  const wasReview = phase === 'review';
  const out = { phase, learningStep: step, lapses, intervalDays: prevInterval || 0, minutes: 0, easeFactor: ease, correct, graduatedToReview: false };

  if (phase === 'learning' || phase === 'relearning') {
    const steps = phase === 'learning' ? LEARNING_STEPS : RELEARNING_STEPS;
    if (r === 1) {
      // Again — back to the first step.
      return { ...out, learningStep: 0, minutes: steps[0], intervalDays: 0 };
    }
    if (r === 2) {
      // Hard — repeat the current step.
      const s = Math.min(step, steps.length - 1);
      return { ...out, learningStep: s, minutes: steps[s], intervalDays: 0 };
    }
    // Good (3) / Easy (4) — advance, or graduate to review.
    const graduate = r === 4 || step >= steps.length - 1;
    if (graduate) {
      const intervalDays = phase === 'relearning' ? Math.max(1, prevInterval || 1) : r === 4 ? EASY_GRAD_DAYS : 1;
      return { ...out, phase: 'review', learningStep: 0, intervalDays, minutes: 0, easeFactor: clampEase(ease), graduatedToReview: true };
    }
    const next = step + 1;
    return { ...out, learningStep: next, minutes: steps[next], intervalDays: 0 };
  }

  // Review phase.
  const interval = prevInterval || 1;
  if (r === 1) {
    // Lapse → relearning; drop ease, halve the interval for when it graduates back.
    return {
      phase: 'relearning', learningStep: 0, lapses: lapses + 1,
      intervalDays: Math.max(1, Math.round(interval * 0.5)), minutes: RELEARNING_STEPS[0],
      easeFactor: clampEase(ease - 0.2), correct: false, graduatedToReview: false,
    };
  }
  let newEase = ease;
  let intervalDays;
  if (r === 2) {
    newEase = clampEase(ease - 0.15);
    intervalDays = Math.max(interval + 1, Math.round(interval * 1.2));
  } else if (r === 3) {
    intervalDays = Math.max(interval + 1, Math.round(interval * ease));
  } else {
    newEase = Math.min(DEFAULT_EASE, clampEase(ease + 0.15));
    intervalDays = Math.max(interval + 1, Math.round(interval * ease * EASY_BONUS));
  }
  void wasReview;
  return { phase: 'review', learningStep: 0, lapses, intervalDays, minutes: 0, easeFactor: newEase, correct: true, graduatedToReview: false };
}

/** Derive a card's mastery status + a 0–100 progress percent from its phase. */
function deriveMastery({ phase, intervalDays, totalReviews }) {
  let status;
  if (totalReviews === 0) status = 'new';
  else if (phase === 'review') status = intervalDays >= 21 ? 'mastered' : 'review';
  else status = 'learning'; // learning or relearning
  const masteryPercent =
    status === 'new' ? 0
      : status === 'learning' ? 30
        : status === 'mastered' ? 100
          : Math.min(95, 55 + Math.round((Math.min(intervalDays, 30) / 30) * 40));
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
export async function reviewCard(userId, cardId, { rating, timeSpentSeconds, sessionId }) {
  const card = await getOwnedCard(userId, cardId); // 404s if not owned

  return withTransaction(async (client) => {
    // Previous schedule = latest review for this card (defaults = a new card in learning).
    const { rows: prevRows } = await client.query(
      `SELECT phase, learning_step, lapses, interval_days, ease_factor FROM card_reviews
        WHERE card_id = $1 ORDER BY reviewed_at DESC LIMIT 1`,
      [cardId],
    );
    const prev = prevRows[0];
    const sched = scheduleCard({
      rating,
      phase: prev?.phase ?? 'learning',
      step: prev?.learning_step ?? 0,
      lapses: prev?.lapses ?? 0,
      prevInterval: prev?.interval_days ?? 0,
      prevEase: prev?.ease_factor != null ? Number(prev.ease_factor) : DEFAULT_EASE,
    });
    const { phase, learningStep, lapses, intervalDays, minutes, easeFactor, correct, graduatedToReview } = sched;

    // next_review_at: minutes for learning/relearning, days for review.
    const { rows: reviewRows } = await client.query(
      `INSERT INTO card_reviews
         (user_id, card_id, time_spent_seconds, confidence, correct,
          phase, learning_step, lapses, interval_days, ease_factor, next_review_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + make_interval(days => $9, mins => $11))
       RETURNING *`,
      [userId, cardId, timeSpentSeconds ?? null, rating, correct, phase, learningStep, lapses, intervalDays, easeFactor, minutes],
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
        ? rating
        : Math.round(((prevAvg * (totalReviews - 1) + rating) / totalReviews) * 100) / 100;
    const { status, masteryPercent } = deriveMastery({ phase, intervalDays, totalReviews });

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
        rating,
        correct,
        phase,
        learningStep,
        lapses,
        intervalDays,
        easeFactor: Number(easeFactor),
        nextReviewAt: review.next_review_at,
      },
      graduatedToReview,
      mastery: { status, masteryPercent, totalReviews, correctCount },
    };
  });
}

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
