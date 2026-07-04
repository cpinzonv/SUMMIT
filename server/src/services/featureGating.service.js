/**
 * Feature gating — single source of truth for premium access.
 *
 * canAccessFeature(user, feature):
 *   - admin / demo                        → always allowed (internal + showcase)
 *   - BILLING_ENABLED=false               → nobody else (premium is admin/demo-only
 *                                           until billing goes live)
 *   - BILLING_ENABLED=true + pro + active → allowed (paying subscriber)
 *   - otherwise                           → denied
 *
 * BILLING_ENABLED is the master switch: flip it on (with Stripe wired) to let
 * paying subscribers in. The `user` argument is a DB row (snake_case columns).
 */
import { query } from '../config/db.js';
import { env } from '../config/env.js';

// feature key → display label (also the set of premium features).
export const PREMIUM_FEATURES = {
  podcasts: 'Podcasts',
  quizzes: 'Quizzes',
  studyGuides: 'Study Guides',
  mindMaps: 'Mind Maps',
  googleCalendarSync: 'Google Calendar Sync',
};

// Features an institution's per-tier flags govern. A premium feature NOT in this
// set (e.g. googleCalendarSync) stays available to institution users while their
// contract is active — only these are toggled by the institution.
const INSTITUTION_GATED = new Set(['transcription', 'summaries', 'quizzes', 'studyGuides', 'mindMaps', 'podcasts']);

/**
 * Institution access for a gating row. Returns null for individual users;
 * otherwise { active, reason?, flags }. Tolerant of partial rows (the auth
 * toPublicUser row has institution_id but not the joined institution columns —
 * it's treated as active, which is correct since login already blocks revoked/
 * expired institutions).
 */
function institutionAccessOf(user) {
  if (!user?.institution_id) return null;
  if (user.institution_revoked_at) return { active: false, reason: 'revoked', flags: {} };
  const end = user.institution_contract_end;
  if (end && String(end).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    return { active: false, reason: 'expired', flags: {} };
  }
  let flags = user.institution_feature_flags || {};
  if (typeof flags === 'string') { try { flags = JSON.parse(flags); } catch { flags = {}; } }
  return { active: true, flags };
}

/**
 * Can this user use the given premium feature? Institution members are governed
 * by their institution's contract + feature flags (NOT individual billing);
 * everyone else falls through to the subscription/whitelist path.
 */
export function canAccessFeature(user, featureName) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'demo') return true;

  const inst = institutionAccessOf(user);
  if (inst) {
    if (!inst.active) return false; // revoked or contract expired → locked out
    if (featureName == null) return true; // overall access (active institution)
    if (INSTITUTION_GATED.has(featureName)) return Boolean(inst.flags[featureName]);
    return true; // non-institutional feature: allowed while the contract is active
  }

  if (user.is_whitelisted) return true; // admin-granted comp access
  if (!env.billingEnabled) return false; // pre-billing: admin/demo/whitelist only
  return user.subscription_tier === 'pro' && user.subscription_status === 'active';
}

export { institutionAccessOf };

/** Back-compat alias: overall premium access (feature-agnostic). */
export const hasPremiumAccess = (user) => canAccessFeature(user, null);

/** Per-feature status object for the client (lock icons + paywall messaging). */
export function getFeatureStatus(user, featureName) {
  const hasAccess = canAccessFeature(user, featureName);
  const label = PREMIUM_FEATURES[featureName] || featureName;
  const inst = institutionAccessOf(user);
  let message = '';
  if (!hasAccess) {
    if (inst && !inst.active) {
      message = inst.reason === 'expired'
        ? 'Your institution’s Summit contract has ended.'
        : 'Your institution’s access has been revoked.';
    } else if (inst) {
      message = `${label} isn’t included in your institution’s plan.`;
    } else {
      message = `${label} is available on Summit Pro.`;
    }
  }
  return {
    feature: featureName,
    hasAccess,
    isPremium: Boolean(user?.is_premium),
    billingEnabled: env.billingEnabled,
    userRole: user?.role || 'user',
    userTier: user?.subscription_tier || 'free',
    institution: inst ? { active: inst.active } : null,
    message,
  };
}

/** Status for every premium feature, keyed by feature name. */
export function getAllFeatureStatus(user) {
  const features = {};
  for (const name of Object.keys(PREMIUM_FEATURES)) features[name] = getFeatureStatus(user, name);
  return {
    features,
    userRole: user?.role || 'user',
    subscriptionTier: user?.subscription_tier || 'free',
    subscriptionStatus: user?.subscription_status || 'none',
    billingEnabled: env.billingEnabled,
    premium: canAccessFeature(user, null),
  };
}

/** Fetch the gating-relevant columns for a user id, incl. whitelist membership. */
export async function getUserGating(userId) {
  const { rows } = await query(
    `SELECT u.role, u.plan, u.is_premium, u.subscription_tier, u.subscription_status,
            u.subscription_end_date,
            (w.user_id IS NOT NULL) AS is_whitelisted,
            u.institution_id,
            i.feature_flags AS institution_feature_flags,
            i.contract_end  AS institution_contract_end,
            i.revoked_at    AS institution_revoked_at
       FROM users u
       LEFT JOIN premium_whitelist w ON w.user_id = u.id
       LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
}

// ---- Whitelist management (admin) ------------------------------------------

export async function isUserWhitelisted(userId) {
  const { rows } = await query('SELECT 1 FROM premium_whitelist WHERE user_id = $1', [userId]);
  return rows.length > 0;
}

/** Whitelist a user (by id). Idempotent — re-adding updates the reason/grantor. */
export async function addToWhitelist({ userId, reason, whitelistedBy }) {
  const { rows } = await query(
    `INSERT INTO premium_whitelist (user_id, reason, whitelisted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, whitelisted_by = EXCLUDED.whitelisted_by
     RETURNING *`,
    [userId, reason ?? null, whitelistedBy ?? null],
  );
  return rows[0];
}

export async function removeFromWhitelist(userId) {
  const { rowCount } = await query('DELETE FROM premium_whitelist WHERE user_id = $1', [userId]);
  return rowCount > 0;
}

/** List whitelisted users with their email/name + reason/date. */
export async function listWhitelist() {
  const { rows } = await query(
    `SELECT w.user_id, u.email, u.full_name AS name, w.reason, w.whitelisted_at
       FROM premium_whitelist w JOIN users u ON u.id = w.user_id
      ORDER BY w.whitelisted_at DESC`,
  );
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    reason: r.reason,
    whitelistedAt: r.whitelisted_at,
  }));
}
