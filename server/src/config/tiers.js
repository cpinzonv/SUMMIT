/**
 * Tier limits + paywall pricing — the SINGLE source of truth for monetization.
 * Imported by the gating service, the billing routes, and (via /api/billing/status)
 * the client paywall. Change limits/copy here only.
 *
 * A metric limit is { limit, period, ... }:
 *   - limit: number cap, or null = unlimited
 *   - period: 'semester' | 'month' | 'lifetime' — drives the usage_counters period_key
 * Manual flashcard creation and core organization features are NEVER gated.
 */

export const TIERS = ['free', 'pro', 'max'];

export const TIER_LIMITS = {
  free: {
    // 2 syllabus extractions per semester
    extraction: { limit: 2, period: 'semester' },
    // 50 AI-generated cards, lifetime
    ai_cards: { limit: 50, period: 'lifetime' },
    // 2 recordings, ≤90 min each, tracked as 180 minutes/semester
    transcription_minutes: { limit: 180, period: 'semester', maxPerRecording: 90, maxRecordings: 2 },
    // 1 podcast lifetime, standard voice only
    podcasts: { limit: 1, period: 'lifetime', premiumVoice: false },
    // Ad-hoc paid AI calls (chatbot, re-transcribe, summarize, time-estimate,
    // quiz/guide/mindmap generation) share one monthly per-account budget so a
    // single account can't loop them to run up the Claude/Whisper bill.
    ai_requests: { limit: 40, period: 'month' },
    lms_sync: false,
  },
  pro: {
    extraction: { limit: null, period: 'semester' },
    ai_cards: { limit: null, period: 'lifetime' },
    transcription_minutes: { limit: 480, period: 'month' },
    podcasts: { limit: 3, period: 'month', premiumVoice: false },
    ai_requests: { limit: 400, period: 'month' },
    lms_sync: true,
  },
  max: {
    extraction: { limit: null, period: 'semester' },
    ai_cards: { limit: null, period: 'lifetime' },
    transcription_minutes: { limit: 1800, period: 'month' },
    podcasts: { limit: 10, period: 'month', premiumVoice: true },
    // Even Max (and admin/demo, which resolve to Max) is capped, not unlimited.
    ai_requests: { limit: 2000, period: 'month' },
    lms_sync: true,
  },
};

/** Metric → the gate name surfaced to the client/modal. */
export const METRIC_GATE = {
  extraction: 'extraction',
  ai_cards: 'ai_cards',
  transcription_minutes: 'transcription',
  podcasts: 'podcasts',
  ai_requests: 'ai_requests',
};

/**
 * Which tier a gate upsells to (drives Pro-card vs Max-card in the modal).
 * extraction / ai_cards / transcription → Pro. premium_voice → Max. The podcasts
 * gate is Pro from free, but a Pro user who hits their podcast COUNT cap upsells
 * to Max — that nuance is decided in the service (requiredTier on the payload).
 */
export const GATE_REQUIRED_TIER = {
  extraction: 'pro',
  ai_cards: 'pro',
  transcription: 'pro',
  podcasts: 'pro',
  ai_requests: 'pro',
  premium_voice: 'max',
};

/** Never gate these — manual card creation + core organization features. */
export const NEVER_GATED = [
  'manual_flashcards',
  'calendar',
  'assignments',
  'grades',
  'gpa',
  'planner',
  'kanban',
  'notes',
];

/** Fake-door pricing copy. Exact strings — the modal renders these verbatim. */
export const PRICING = {
  pro: {
    name: 'SUMMIT PRO',
    badge: 'Most Popular',
    priceMonthly: '$5.55/mo',
    priceSemester: 'billed once — $24.99 for the full semester',
    bullets: [
      'Like getting 6 weeks free vs. monthly',
      'One payment, covered through the end of the term',
      'No auto-renewal — we ask before next semester',
    ],
    altLine: 'or $8.99/month, cancel anytime in one click',
  },
  max: {
    name: 'SUMMIT MAX',
    badge: null,
    priceMonthly: '$11.11/mo',
    priceSemester: 'billed once — $49.99 for the full semester',
    bullets: [
      '30 hours of transcription every month',
      '10 podcasts a month, premium AI voices included',
      'No auto-renewal — we ask before next semester',
    ],
    altLine: 'or $14.99/month, cancel anytime in one click',
  },
};

/** Limit object for (tier, metric), or null if the metric is unknown. */
export function limitFor(tier, metric) {
  return TIER_LIMITS[tier]?.[metric] ?? null;
}

/**
 * usage_counters period_key for a period + date. Semester: S1=Jan1–Jun30,
 * S2=Jul1–Dec31 (calendar months, server-local). Monthly: YYYY-MM. Lifetime:
 * a constant so the row is per-user-per-metric forever.
 */
export function periodKeyFor(period, now = new Date()) {
  if (period === 'lifetime') return 'lifetime';
  const year = now.getFullYear();
  if (period === 'month') return `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (period === 'semester') return `${year}-${now.getMonth() < 6 ? 'S1' : 'S2'}`; // Jan–Jun = S1
  throw new Error(`Unknown usage period: ${period}`);
}

/**
 * When the current usage window resets, as a 'YYYY-MM-DD' date. Monthly → first
 * of next month. Semester → next boundary (S1 ends Jun 30 → Jul 1; S2 ends
 * Dec 31 → Jan 1). Lifetime → null (never resets). Drives the QuietNotice copy.
 */
export function resetDateFor(period, now = new Date()) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (period === 'lifetime') return null;
  if (period === 'month') return iso(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  if (period === 'semester') {
    return now.getMonth() < 6
      ? iso(new Date(now.getFullYear(), 6, 1)) // → Jul 1
      : iso(new Date(now.getFullYear() + 1, 0, 1)); // → Jan 1 next year
  }
  throw new Error(`Unknown usage period: ${period}`);
}
