/**
 * Detailed Learn-tab analytics — per-format stats, topic (tag) breakdown, time
 * breakdown, efficiency, and trends. Read-only aggregates over the existing
 * tables (card_reviews, quizzes, podcasts, study_guides, mind_maps, flashcards,
 * learning_sessions). Optional class filter + time range.
 */
import { query } from '../config/db.js';

const RANGE_DAYS = { '7days': 7, '30days': 30, alltime: null };

/** Build a "reviewed_at >= now() - interval" clause + params, or empty for alltime. */
function rangeClause(col, days, params) {
  if (!days) return '';
  params.push(days);
  return ` AND ${col} >= now() - ($${params.length} || ' days')::interval`;
}

export async function calculateDetailedAnalytics(userId, { classId = null, timeRange = '30days' } = {}) {
  const days = RANGE_DAYS[timeRange] ?? 30;
  const classFilter = (alias) => (classId ? ` AND ${alias} = $2` : '');
  const base = classId ? [userId, classId] : [userId];

  // --- Flashcards (reviews in range) ---
  const fcParams = [...base];
  const flashcards = await query(
    `SELECT count(*)::int AS reviews,
            COALESCE(ROUND(AVG(confidence)::numeric, 2), 0) AS avg_confidence,
            COALESCE(SUM(time_spent_seconds), 0)::int AS seconds,
            count(*) FILTER (WHERE reviewed_at >= date_trunc('day', now()))::int AS reviewed_today
       FROM card_reviews cr
       JOIN flashcards f ON f.id = cr.card_id
      WHERE cr.user_id = $1${classFilter('f.class_id')}${rangeClause('cr.reviewed_at', days, fcParams)}`,
    fcParams,
  );
  const totalCards = await query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE m.status = 'mastered')::int AS mastered
       FROM flashcards f
       LEFT JOIN mastery_levels m ON m.card_id = f.id AND m.user_id = f.user_id
      WHERE f.user_id = $1${classFilter('f.class_id')}`,
    base,
  );

  // --- Quizzes (attempted in range) ---
  const qParams = [...base];
  const quizzes = await query(
    `SELECT count(*)::int AS taken,
            COALESCE(ROUND(AVG(score)), 0)::int AS avg_score,
            COALESCE(MAX(score), 0)::int AS best, COALESCE(MIN(score), 0)::int AS worst,
            COALESCE(SUM(time_spent_seconds), 0)::int AS seconds
       FROM quizzes
      WHERE user_id = $1 AND attempted_at IS NOT NULL${classFilter('class_id')}${rangeClause('attempted_at', days, qParams)}`,
    qParams,
  );

  // --- Podcasts ---
  const podcasts = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE listened_at IS NOT NULL)::int AS listened,
            COALESCE(ROUND(AVG(NULLIF(completion_percent, 0))), 0)::int AS avg_completion,
            COALESCE(ROUND(SUM(duration_seconds * completion_percent / 100.0) / 60.0), 0)::int AS minutes
       FROM podcasts WHERE user_id = $1${classFilter('class_id')}`,
    base,
  );

  // --- Guides + mind maps ---
  const guides = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE read_at IS NOT NULL)::int AS read,
            count(*) FILTER (WHERE bookmarked)::int AS bookmarked
       FROM study_guides WHERE user_id = $1${classFilter('class_id')}`,
    base,
  );
  const mindmaps = await query(
    `SELECT count(*)::int AS total,
            COALESCE(ROUND(AVG(jsonb_array_length(nodes))), 0)::int AS avg_nodes
       FROM mind_maps WHERE user_id = $1${classFilter('class_id')}`,
    base,
  );

  // --- Topic breakdown by tag ---
  const topics = await query(
    `SELECT tag,
            count(DISTINCT f.id)::int AS cards,
            COALESCE(ROUND(AVG(m.mastery_percent)), 0)::int AS mastery,
            COALESCE(ROUND(SUM(r.secs) / 60.0), 0)::int AS minutes
       FROM flashcards f
       LEFT JOIN mastery_levels m ON m.card_id = f.id AND m.user_id = f.user_id
       LEFT JOIN LATERAL (SELECT SUM(time_spent_seconds) AS secs FROM card_reviews cr WHERE cr.card_id = f.id) r ON true
       CROSS JOIN LATERAL unnest(CASE WHEN array_length(f.tags, 1) IS NULL THEN ARRAY['untagged'] ELSE f.tags END) AS tag
      WHERE f.user_id = $1${classFilter('f.class_id')}
      GROUP BY tag ORDER BY cards DESC LIMIT 12`,
    base,
  );

  const fc = flashcards.rows[0];
  const q = quizzes.rows[0];
  const p = podcasts.rows[0];
  const flashcardMinutes = Math.round(fc.seconds / 60);
  const quizMinutes = Math.round(q.seconds / 60);
  const timeStats = {
    flashcardsMinutes: flashcardMinutes,
    quizzesMinutes: quizMinutes,
    podcastsMinutes: p.minutes,
    guidesMinutes: 0, // reading time not tracked
    mindmapsMinutes: 0,
    totalMinutes: flashcardMinutes + quizMinutes + p.minutes,
  };

  // Efficiency: cards reviewed per hour of flashcard study.
  const cardsPerHour = flashcardMinutes > 0 ? Math.round((fc.reviews / flashcardMinutes) * 60) : 0;

  return {
    timeRange,
    flashcardStats: {
      totalCards: totalCards.rows[0].n,
      masteredCards: totalCards.rows[0].mastered,
      reviews: fc.reviews,
      reviewedToday: fc.reviewed_today,
      averageConfidence: Number(fc.avg_confidence),
    },
    quizStats: {
      quizzesTaken: q.taken,
      averageScore: q.avg_score,
      bestScore: q.best,
      worstScore: q.worst,
      averageTimeMinutes: q.taken ? Math.round(q.seconds / 60 / q.taken) : 0,
    },
    podcastStats: {
      podcasts: p.total,
      podcastsListened: p.listened,
      totalListeningMinutes: p.minutes,
      averageCompletion: p.avg_completion,
    },
    guideStats: { guides: guides.rows[0].total, guidesRead: guides.rows[0].read, guidesBookmarked: guides.rows[0].bookmarked },
    mindmapStats: { mindmaps: mindmaps.rows[0].total, averageNodesPerMap: mindmaps.rows[0].avg_nodes },
    topicStats: topics.rows.map((t) => ({ topic: t.tag, cards: t.cards, mastery: t.mastery, minutes: t.minutes })),
    timeStats,
    efficiency: { cardsPerHour },
  };
}

/** Trends for charts: daily study minutes (14d), last 8 quiz scores, weekly confidence. */
export async function getTrends(userId, { classId = null } = {}) {
  const base = classId ? [userId, classId] : [userId];
  const cf = (alias) => (classId ? ` AND ${alias} = $2` : '');

  const studyTime = await query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(ROUND(SUM(cr.time_spent_seconds) / 60.0), 0)::int AS minutes
       FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS d(day)
       LEFT JOIN card_reviews cr ON date_trunc('day', cr.reviewed_at) = d.day AND cr.user_id = $1
       LEFT JOIN flashcards f ON f.id = cr.card_id
      WHERE TRUE${classId ? ' AND (f.class_id = $2 OR f.class_id IS NULL)' : ''}
      GROUP BY d.day ORDER BY d.day`,
    base,
  );

  const quizScores = await query(
    `SELECT score, to_char(attempted_at, 'MM-DD') AS date FROM quizzes
      WHERE user_id = $1 AND attempted_at IS NOT NULL${cf('class_id')}
      ORDER BY attempted_at DESC LIMIT 8`,
    base,
  );

  const mastery = await query(
    `SELECT to_char(date_trunc('week', cr.reviewed_at), 'YYYY-MM-DD') AS week,
            ROUND(AVG(cr.confidence) / 5.0 * 100)::int AS pct
       FROM card_reviews cr JOIN flashcards f ON f.id = cr.card_id
      WHERE cr.user_id = $1${cf('f.class_id')} AND cr.reviewed_at >= now() - interval '8 weeks'
      GROUP BY 1 ORDER BY 1`,
    base,
  );

  return {
    studyTimeTrend: studyTime.rows,
    quizScoreTrend: quizScores.rows.reverse().map((r) => ({ date: r.date, score: r.score })),
    masteryTrend: mastery.rows.map((r) => ({ week: r.week, pct: r.pct })),
  };
}
