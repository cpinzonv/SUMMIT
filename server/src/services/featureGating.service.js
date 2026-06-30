/**
 * Feature gating — the single source of truth for "can this user use premium
 * Learn formats?" (quizzes, podcasts, study guides, mind maps). Flashcards are
 * always free.
 *
 * Access rule (independent of BILLING_ENABLED):
 *   - role 'admin' or 'demo'        → full access (internal / demo bypass)
 *   - is_premium = true             → full access (manual override)
 *   - an ACTIVE pro subscription    → full access (subscription_tier='pro' and
 *     subscription_status='active'), or the legacy plan='pro' flag
 *
 * BILLING_ENABLED only controls whether the paywall can actually sell a
 * subscription yet (Stripe is a future wire-up). When false, the paywall is a
 * friendly "coming soon"; the gate itself is always enforced.
 */
import { query } from '../config/db.js';
import { env } from '../config/env.js';

export const PREMIUM_FEATURES = ['quizzes', 'podcasts', 'guides', 'mindmaps'];

/** Does this user row have premium access? */
export function hasPremiumAccess(u) {
  if (!u) return false;
  if (u.role === 'admin' || u.role === 'demo') return true;
  if (u.is_premium) return true;
  const proTier = u.subscription_tier === 'pro' && u.subscription_status === 'active';
  return Boolean(proTier || u.plan === 'pro');
}

/** Fetch the gating-relevant columns for a user. */
async function getUserGating(userId) {
  const { rows } = await query(
    `SELECT role, plan, is_premium, subscription_tier, subscription_status,
            subscription_end_date
       FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * Full feature status for the client. `premium` = does the user have access;
 * `features` maps each premium feature to a boolean; flashcards always true.
 */
export async function getFeatureStatus(userId) {
  const u = await getUserGating(userId);
  const premium = hasPremiumAccess(u);
  const features = { flashcards: true };
  for (const f of PREMIUM_FEATURES) features[f] = premium;
  return {
    billingEnabled: env.billingEnabled,
    premium,
    role: u?.role || 'user',
    subscriptionTier: u?.subscription_tier || 'free',
    subscriptionStatus: u?.subscription_status || 'none',
    subscriptionEndDate: u?.subscription_end_date ?? null,
    features,
  };
}

export { getUserGating };
