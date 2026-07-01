import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { sm2 } from './sm2.service.js';
import { toPublicCard } from './flashcard.service.js';

/**
 * Deck-scoped study orchestration: classic SM-2 rating (persisted on the
 * flashcards row), per-deck settings (deadline / daily limits / interleaving),
 * daily stats, the study-plan projection, and today's study queue.
 */

// Rough model for time projections (tuned for short recall reps).
const SECONDS_PER_INTERACTION = 20;

async function getOwnedDeck(userId, deckId) {
  const { rows } = await query('SELECT * FROM decks WHERE id = $1 AND user_id = $2', [deckId, userId]);
  if (!rows[0]) throw AppError.notFound('Deck not found');
  return rows[0];
}

function toPublicSettings(s) {
  return {
    deckId: s.deck_id,
    deadline: s.deadline,
    dailyNewCardLimit: s.daily_new_card_limit,
    maxCardsPerSession: s.max_cards_per_session,
    interleavingEnabled: s.interleaving_enabled,
    userDailyStudyLimit: s.user_daily_study_limit,
  };
}

/** Ensure a deck_settings row exists (defaults), returning the raw row. */
async function ensureSettings(userId, deckId) {
  await getOwnedDeck(userId, deckId);
  const { rows } = await query('SELECT * FROM deck_settings WHERE deck_id = $1', [deckId]);
  if (rows[0]) return rows[0];
  const { rows: created } = await query(
    'INSERT INTO deck_settings (deck_id, user_id) VALUES ($1, $2) RETURNING *',
    [deckId, userId],
  );
  return created[0];
}

export async function getDeckSettings(userId, deckId) {
  return toPublicSettings(await ensureSettings(userId, deckId));
}

export async function updateDeckSettings(userId, deckId, patch) {
  await ensureSettings(userId, deckId);
  const map = {
    deadline: 'deadline',
    dailyNewCardLimit: 'daily_new_card_limit',
    maxCardsPerSession: 'max_cards_per_session',
    interleavingEnabled: 'interleaving_enabled',
    userDailyStudyLimit: 'user_daily_study_limit',
  };
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      vals.push(patch[k]);
      sets.push(`${col} = $${vals.length}`);
    }
  }
  if (!sets.length) return getDeckSettings(userId, deckId);
  vals.push(deckId);
  const { rows } = await query(
    `UPDATE deck_settings SET ${sets.join(', ')} WHERE deck_id = $${vals.length} RETURNING *`,
    vals,
  );
  return toPublicSettings(rows[0]);
}

/** Today's per-deck counters (zeros if nothing studied yet today). */
async function todayStats(userId, deckId) {
  const { rows } = await query(
    `SELECT new_cards_added, cards_reviewed, total_interactions
       FROM deck_study_stats WHERE deck_id = $1 AND user_id = $2 AND date = CURRENT_DATE`,
    [deckId, userId],
  );
  return rows[0] || { new_cards_added: 0, cards_reviewed: 0, total_interactions: 0 };
}

/**
 * Rate a card (1–5) → classic SM-2. Persists the schedule on the flashcards
 * row, appends a card_reviews history entry, and bumps the deck's daily stats.
 */
export async function rateCard(userId, cardId, rating, timeSpentSeconds = null) {
  // Clamp against a backgrounded tab inflating study time.
  const secs = Number.isFinite(timeSpentSeconds)
    ? Math.max(0, Math.min(3600, Math.round(timeSpentSeconds)))
    : null;
  return withTransaction(async (client) => {
    const { rows: cardRows } = await client.query(
      'SELECT * FROM flashcards WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [cardId, userId],
    );
    const card = cardRows[0];
    if (!card) throw AppError.notFound('Flashcard not found');

    const wasNew = card.next_review_date === null && card.repetitions === 0;
    const res = sm2({
      rating,
      easeFactor: Number(card.ease_factor),
      interval: card.sm2_interval,
      repetitions: card.repetitions,
    });
    const nextDays = res.shouldShowAgainToday ? 0 : res.interval;

    const { rows: upd } = await client.query(
      `UPDATE flashcards
          SET ease_factor = $2, sm2_interval = $3, repetitions = $4,
              next_review_date = now() + make_interval(days => $5)
        WHERE id = $1
        RETURNING ease_factor, sm2_interval, repetitions, next_review_date`,
      [cardId, res.easeFactor, res.interval, res.repetitions, nextDays],
    );

    // History log (drives streaks + study-time analytics).
    await client.query(
      `INSERT INTO card_reviews
         (user_id, card_id, time_spent_seconds, confidence, correct, interval_days, ease_factor, next_review_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8))`,
      [userId, cardId, secs, rating, rating >= 3, res.interval, res.easeFactor, nextDays],
    );

    // Daily deck stats.
    if (card.deck_id) {
      const { rows: avgRows } = await client.query(
        'SELECT round(avg(ease_factor), 2) AS avg_ef FROM flashcards WHERE deck_id = $1 AND user_id = $2',
        [card.deck_id, userId],
      );
      const avgEf = avgRows[0]?.avg_ef ?? null;
      await client.query(
        `INSERT INTO deck_study_stats
           (deck_id, user_id, date, new_cards_added, cards_reviewed, total_interactions, average_ease_factor)
         VALUES ($1, $2, CURRENT_DATE, $3, 1, 1, $4)
         ON CONFLICT (deck_id, user_id, date) DO UPDATE
           SET new_cards_added = deck_study_stats.new_cards_added + $3,
               cards_reviewed = deck_study_stats.cards_reviewed + 1,
               total_interactions = deck_study_stats.total_interactions + 1,
               average_ease_factor = $4`,
        [card.deck_id, userId, wasNew ? 1 : 0, avgEf],
      );
    }

    return {
      shouldShowAgainToday: res.shouldShowAgainToday,
      nextReviewDate: upd[0].next_review_date,
      easeFactor: Number(upd[0].ease_factor),
      interval: upd[0].sm2_interval,
      repetitions: upd[0].repetitions,
    };
  });
}

/** Today's study queue for a deck, respecting the new-card + interaction limits. */
export async function getStudyToday(userId, deckId) {
  const settings = await ensureSettings(userId, deckId);
  const stats = await todayStats(userId, deckId);
  const newRemaining = Math.max(0, settings.daily_new_card_limit - stats.new_cards_added);

  const notSuspended = `f.is_suspended = false AND (f.bury_until IS NULL OR f.bury_until <= now())`;

  const { rows: newCards } = await query(
    `SELECT f.* FROM flashcards f
      WHERE f.deck_id = $1 AND f.user_id = $2 AND ${notSuspended}
        AND f.next_review_date IS NULL
      ORDER BY f.created_at ASC
      LIMIT $3`,
    [deckId, userId, newRemaining],
  );
  const { rows: reviewCards } = await query(
    `SELECT f.* FROM flashcards f
      WHERE f.deck_id = $1 AND f.user_id = $2 AND ${notSuspended}
        AND f.next_review_date IS NOT NULL AND f.next_review_date <= now()
      ORDER BY f.next_review_date ASC
      LIMIT $3`,
    [deckId, userId, settings.max_cards_per_session * 3],
  );

  const interactionsToday = stats.total_interactions;
  const studyLimit = settings.user_daily_study_limit;
  const scheduledToday = newCards.length + reviewCards.length;
  const sessionsNeeded = Math.max(1, Math.ceil(scheduledToday / settings.max_cards_per_session));
  const sessionsCompleted = Math.floor(interactionsToday / settings.max_cards_per_session);

  return {
    newCards: newCards.map(toPublicCard),
    reviewCards: reviewCards.map(toPublicCard),
    scheduledToday,
    interactionsToday,
    studyLimit,
    remaining: Math.max(0, studyLimit - interactionsToday),
    interleavingEnabled: settings.interleaving_enabled,
    maxCardsPerSession: settings.max_cards_per_session,
    sessionsCompleted,
    sessionsNeeded,
  };
}

/** Deadline-driven study plan: pace needed, projections, on-track status. */
export async function getStudyPlan(userId, deckId) {
  const deck = await getOwnedDeck(userId, deckId);
  const settings = await ensureSettings(userId, deckId);
  const stats = await todayStats(userId, deckId);

  const { rows: cnt } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE repetitions >= 1)::int AS learned
       FROM flashcards WHERE deck_id = $1 AND user_id = $2`,
    [deckId, userId],
  );
  const total = cnt[0].total;
  const learned = cnt[0].learned;

  let daysRemaining = null;
  let plan = null;
  if (settings.deadline) {
    daysRemaining = Math.max(0, Math.ceil((new Date(settings.deadline) - new Date()) / 86400000));
    const remainingCards = Math.max(0, total - learned);
    const dailyNewCardsNeeded = daysRemaining > 0 ? Math.ceil(remainingCards / daysRemaining) : remainingCards;
    const estimatedDailyInteractions = dailyNewCardsNeeded * 3 + Math.round(learned / 5);
    const estimatedMinutesPerDay = Math.round((estimatedDailyInteractions * SECONDS_PER_INTERACTION) / 60);
    const recommendedSessionsPerDay = Math.max(
      1,
      Math.ceil(estimatedDailyInteractions / settings.max_cards_per_session),
    );
    const { rows: pace } = await query(
      `SELECT COALESCE(avg(new_cards_added), 0)::float AS avg_new
         FROM deck_study_stats
        WHERE deck_id = $1 AND user_id = $2 AND date >= CURRENT_DATE - 6`,
      [deckId, userId],
    );
    const recentAvgNewPerDay = Math.round(pace[0].avg_new * 10) / 10;
    const isOnTrack =
      remainingCards === 0
        ? true
        : recentAvgNewPerDay === 0
          ? dailyNewCardsNeeded <= settings.daily_new_card_limit
          : recentAvgNewPerDay >= dailyNewCardsNeeded;
    plan = {
      dailyNewCardsNeeded,
      estimatedDailyInteractions,
      estimatedMinutesPerDay,
      recommendedSessionsPerDay,
      isOnTrack,
      recentAvgNewPerDay,
    };
  }

  const maxPer = settings.max_cards_per_session;
  return {
    deck: {
      id: deck.id,
      name: deck.name,
      totalCards: total,
      cardsLearned: learned,
      progressPercent: total ? Math.round((learned / total) * 100) : 0,
    },
    deadline: settings.deadline ? new Date(settings.deadline).toISOString().slice(0, 10) : null,
    daysRemaining,
    plan,
    today: {
      newCardsToday: stats.new_cards_added,
      cardsReviewedToday: stats.cards_reviewed,
      totalInteractionsToday: stats.total_interactions,
      sessionsCompleted: Math.floor(stats.total_interactions / maxPer),
      sessionsSuggested: plan?.recommendedSessionsPerDay ?? 1,
    },
  };
}

/** Set a deck's deadline and return the recalculated plan. */
export async function setDeadline(userId, deckId, deadline) {
  await updateDeckSettings(userId, deckId, { deadline });
  return getStudyPlan(userId, deckId);
}
