/**
 * Billing / fake-door paywall service. NOTHING here charges money or touches
 * Stripe — it manages feature flags, founding-member assignment, the waitlist,
 * and conversion-intent (gate_event) analytics. Real checkout is gated behind
 * BILLING_ENABLED + paywall_enabled and is a stub (see billing.controller).
 */
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { PRICING } from '../config/tiers.js';
import { getTierRow, effectiveTier } from './usageGating.service.js';

// Single advisory-lock key so all founding claims serialize (cap stays exact).
const FOUNDING_LOCK_KEY = 918273645;

// ---- Feature flags ---------------------------------------------------------

export async function getFlag(key) {
  const { rows } = await query('SELECT value FROM feature_flags WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setFlag(key, value, updatedBy) {
  const { rows } = await query(
    `INSERT INTO feature_flags (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING key, value, updated_by, updated_at`,
    [key, JSON.stringify(value), updatedBy ?? null],
  );
  return rows[0];
}

export async function foundingCap() {
  const v = await getFlag('founding_member_cap');
  return Number(v?.cap ?? 500);
}

export async function foundingClaimedCount() {
  const { rows } = await query('SELECT count(*)::int AS n FROM users WHERE founding_member_number IS NOT NULL');
  return rows[0].n;
}

// ---- Status (drives the 3-mode modal) --------------------------------------

/** Flags + this user's tier info. Public-ish (auth'd). */
export async function billingStatus(userId) {
  const row = await getTierRow(userId);
  const paywall = await getFlag('paywall_enabled');
  const cap = await foundingCap();
  const claimed = await foundingClaimedCount();
  return {
    paywall_enabled: Boolean(paywall?.enabled),
    billing_enabled: env.billingEnabled,
    founding_cap: cap,
    founding_slots_left: Math.max(cap - claimed, 0),
    pricing: PRICING,
    user: {
      tier: effectiveTier(row), // effective (whitelist/founding resolved)
      raw_tier: row?.tier || 'free',
      founding_member: Boolean(row?.founding_member),
      founding_member_number: row?.founding_member_number || null,
      pro_until: row?.pro_until || null,
    },
  };
}

// ---- Founding member claim (race-safe) -------------------------------------

/**
 * Claim a founding-member slot. Race-safe: a transaction-scoped advisory lock
 * serializes every concurrent claim, so the cap can never be exceeded. Idempotent
 * — a user who already claimed gets their existing number back.
 */
export async function claimFounding(userId) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [FOUNDING_LOCK_KEY]);

    const { rows: userRows } = await client.query(
      'SELECT founding_member, founding_member_number FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const u = userRows[0];
    if (!u) throw AppError.notFound('User not found');
    if (u.founding_member && u.founding_member_number) {
      return { alreadyFounding: true, founding_member_number: u.founding_member_number };
    }

    const capRow = await client.query("SELECT COALESCE((value->>'cap')::int, 500) AS cap FROM feature_flags WHERE key = 'founding_member_cap'");
    const cap = Number(capRow.rows[0]?.cap ?? 500);
    const cntRow = await client.query(
      'SELECT count(*)::int AS n, COALESCE(max(founding_member_number), 0)::int AS maxn FROM users WHERE founding_member_number IS NOT NULL',
    );
    const { n, maxn } = cntRow.rows[0];
    if (n >= cap) return { slotsExhausted: true };

    const next = maxn + 1;
    await client.query(
      `UPDATE users
          SET founding_member = true,
              founding_member_number = $2,
              pro_until = COALESCE(pro_until, now() + interval '1 year')
        WHERE id = $1`,
      [userId, next],
    );
    await client.query(
      "INSERT INTO gate_events (user_id, gate, tier_at_time, action) VALUES ($1, $2, 'free', 'claimed_founding')",
      [userId, 'founding'],
    );
    return { founding_member_number: next };
  });
}

/**
 * Assign a founding number to a brand-new signup if slots remain. Same race-safe
 * path as claimFounding; safe to call best-effort during registration.
 */
export async function assignFoundingOnSignup(userId) {
  try {
    return await claimFounding(userId);
  } catch {
    return { skipped: true }; // never block signup on this
  }
}

// ---- Waitlist + gate events -------------------------------------------------

export async function joinWaitlist(userId, { interestedTier, sourceGate } = {}) {
  const { rows } = await query('SELECT email FROM users WHERE id = $1', [userId]);
  const email = rows[0]?.email ?? null;
  await query(
    `INSERT INTO waitlist (user_id, email, interested_tier, source_gate)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET interested_tier = EXCLUDED.interested_tier, source_gate = EXCLUDED.source_gate`,
    [userId, email, interestedTier ?? null, sourceGate ?? null],
  );
  await logGateEvent(userId, { gate: sourceGate, action: 'joined_waitlist', tierAtTime: null });
  return { joined: true };
}

export async function logGateEvent(userId, { gate, action, tierAtTime }) {
  await query(
    'INSERT INTO gate_events (user_id, gate, tier_at_time, action) VALUES ($1, $2, $3, $4)',
    [userId, gate ?? null, tierAtTime ?? null, action],
  );
  return { logged: true };
}

// ---- Admin queries ----------------------------------------------------------

export async function listFoundingMembers() {
  const { rows } = await query(
    `SELECT u.founding_member_number AS number, u.email, u.full_name AS name, u.pro_until,
            u.updated_at AS claimed_at
       FROM users u
      WHERE u.founding_member_number IS NOT NULL
      ORDER BY u.founding_member_number ASC`,
  );
  return rows;
}

export async function listWaitlist() {
  const { rows } = await query(
    `SELECT w.email, w.interested_tier, w.source_gate, w.created_at, u.full_name AS name
       FROM waitlist w JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC`,
  );
  return rows;
}

const GATE_ACTIONS = ['shown', 'claimed_founding', 'joined_waitlist', 'dismissed', 'upgraded'];

/** Per-gate totals by action, optionally within a date range. */
export async function gateAnalytics({ from, to } = {}) {
  const { rows } = await query(
    `SELECT COALESCE(gate, '(none)') AS gate, action, count(*)::int AS n
       FROM gate_events
      WHERE ($1::timestamptz IS NULL OR created_at >= $1)
        AND ($2::timestamptz IS NULL OR created_at < $2)
      GROUP BY COALESCE(gate, '(none)'), action`,
    [from ?? null, to ?? null],
  );
  const byGate = {};
  for (const r of rows) {
    byGate[r.gate] ??= { gate: r.gate, ...Object.fromEntries(GATE_ACTIONS.map((a) => [a, 0])), total: 0 };
    byGate[r.gate][r.action] = r.n;
    byGate[r.gate].total += r.n;
  }
  return Object.values(byGate).sort((a, b) => b.total - a.total);
}
