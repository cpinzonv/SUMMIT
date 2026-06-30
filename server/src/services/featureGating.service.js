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
  if (!env.billingEnabled) return false; // pre-billing: admin/demo only
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

/** Fetch the gating-relevant columns for a user id. */
export async function getUserGating(userId) {
  const { rows } = await query(
    `SELECT role, plan, is_premium, subscription_tier, subscription_status, subscription_end_date
       FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] || null;
}
