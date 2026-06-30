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

/** Can this user use the given premium feature? */
export function canAccessFeature(user, _featureName) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'demo') return true;
  if (user.is_whitelisted) return true; // admin-granted comp access
  if (!env.billingEnabled) return false; // pre-billing: admin/demo/whitelist only
  return user.subscription_tier === 'pro' && user.subscription_status === 'active';
}

/** Back-compat alias: overall premium access (feature-agnostic). */
export const hasPremiumAccess = (user) => canAccessFeature(user, null);

/** Per-feature status object for the client (lock icons + paywall messaging). */
export function getFeatureStatus(user, featureName) {
  const hasAccess = canAccessFeature(user, featureName);
  const label = PREMIUM_FEATURES[featureName] || featureName;
  return {
    feature: featureName,
    hasAccess,
    isPremium: Boolean(user?.is_premium),
    billingEnabled: env.billingEnabled,
    userRole: user?.role || 'user',
    userTier: user?.subscription_tier || 'free',
    message: hasAccess ? '' : `${label} is available on Summit Pro.`,
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
            (w.user_id IS NOT NULL) AS is_whitelisted
       FROM users u
       LEFT JOIN premium_whitelist w ON w.user_id = u.id
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
