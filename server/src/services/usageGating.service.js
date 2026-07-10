/**
 * Usage-based gating — the metered layer on top of the premium/whitelist system
 * (featureGating.service.js). Resolves a user's EFFECTIVE tier, then checks and
 * atomically consumes per-period usage against tiers.js limits.
 *
 * Effective tier:
 *   admin / demo role        → 'max'  (internal, unlimited)
 *   premium whitelist        → 'pro'  (admin-granted comp — preserves old behavior)
 *   founding + pro_until>now  → 'pro'
 *   otherwise                → users.tier ('free' | 'pro' | 'max')
 * A founding member whose pro_until has passed falls back to users.tier (free).
 */
import { query, withTransaction } from '../config/db.js';
import { TIER_LIMITS, METRIC_GATE, limitFor, periodKeyFor } from '../config/tiers.js';

/** Fetch the columns needed to resolve a user's effective tier. */
export async function getTierRow(userId) {
  const { rows } = await query(
    `SELECT u.id, u.role, u.tier, u.founding_member, u.founding_member_number, u.pro_until,
            (w.user_id IS NOT NULL) AS is_whitelisted
       FROM users u
       LEFT JOIN premium_whitelist w ON w.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/** Resolve the effective tier from a tier row (see module doc). */
export function effectiveTier(row) {
  if (!row) return 'free';
  if (row.role === 'admin' || row.role === 'demo') return 'max';
  if (row.is_whitelisted) return 'pro';
  if (row.founding_member && row.pro_until && new Date(row.pro_until) > new Date()) return 'pro';
  return TIER_LIMITS[row.tier] ? row.tier : 'free';
}

/** Current usage amount for (user, metric, period_key). */
async function currentUsage(userId, metric, periodKey) {
  const { rows } = await query(
    'SELECT amount FROM usage_counters WHERE user_id = $1 AND metric = $2 AND period_key = $3',
    [userId, metric, periodKey],
  );
  return rows[0] ? Number(rows[0].amount) : 0;
}

/** The tier a gate upsells to: free → pro, pro/max cap → max. */
function requiredTierFor(tier) {
  return tier === 'free' ? 'pro' : 'max';
}

/**
 * Check a metric against the user's tier limit and, if allowed, atomically
 * consume `amount`. Returns:
 *   { allowed: true, tier, remaining }            (remaining null = unlimited)
 *   { allowed: false, gate, requiredTier, tier, limit, used }
 *
 * Options:
 *   - premiumVoice: podcast premium-voice request → requires 'max' regardless of count
 *   - consume: false to check without incrementing (e.g. reject a recording START
 *     whose projected minutes would exceed the cap; the real minutes are consumed
 *     on completion)
 *   - tierRow: pass a pre-fetched row to avoid a re-query
 */
export async function checkAndConsume(userId, metric, amount = 1, opts = {}) {
  const { premiumVoice = false, consume = true, tierRow } = opts;
  const row = tierRow || (await getTierRow(userId));
  const tier = effectiveTier(row);

  // Podcast premium voice is a Max-only capability regardless of remaining count.
  if (metric === 'podcasts' && premiumVoice && tier !== 'max') {
    return { allowed: false, gate: 'premium_voice', requiredTier: 'max', tier };
  }

  const limitDef = limitFor(tier, metric);
  if (!limitDef) return { allowed: true, tier, remaining: null }; // metric not gated for this tier

  const gate = METRIC_GATE[metric] || metric;
  const cap = limitDef.limit; // null = unlimited
  const periodKey = periodKeyFor(limitDef.period);

  // Unlimited: record usage for analytics but never block.
  if (cap === null) {
    if (consume) await bumpCounter(userId, metric, periodKey, amount);
    return { allowed: true, tier, remaining: null };
  }

  if (!consume) {
    const used = await currentUsage(userId, metric, periodKey);
    if (used + amount > cap) {
      return { allowed: false, gate, requiredTier: requiredTierFor(tier), tier, limit: cap, used };
    }
    return { allowed: true, tier, remaining: cap - (used + amount) };
  }

  // Atomic consume: increment inside a transaction and roll back if it would
  // exceed the cap. The ON CONFLICT DO UPDATE row lock serializes concurrent
  // requests, so two racing consumes can't both slip over the limit.
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO usage_counters (user_id, metric, period_key, amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, metric, period_key)
         DO UPDATE SET amount = usage_counters.amount + EXCLUDED.amount
         RETURNING amount`,
        [userId, metric, periodKey, amount],
      );
      const newTotal = Number(rows[0].amount);
      if (newTotal > cap) {
        const err = new Error('OVER_LIMIT');
        err.overLimit = true;
        err.used = newTotal - amount;
        throw err; // rolls back the increment
      }
      return { allowed: true, tier, remaining: cap - newTotal };
    });
  } catch (err) {
    if (err.overLimit) {
      return { allowed: false, gate, requiredTier: requiredTierFor(tier), tier, limit: cap, used: err.used };
    }
    throw err;
  }
}

async function bumpCounter(userId, metric, periodKey, amount) {
  await query(
    `INSERT INTO usage_counters (user_id, metric, period_key, amount)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, metric, period_key)
     DO UPDATE SET amount = usage_counters.amount + EXCLUDED.amount`,
    [userId, metric, periodKey, amount],
  );
}
