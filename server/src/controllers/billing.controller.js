/**
 * /api/billing — fake-door paywall + founding members + admin monetization.
 * No Stripe, no charges. /checkout is a stub that only exists so the future
 * real-mode wiring has a home; it 501s today.
 */
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import * as billing from '../services/billing.service.js';

// ---- schemas ---------------------------------------------------------------
export const waitlistSchema = z.object({
  interested_tier: z.enum(['pro', 'max']).optional(),
  source_gate: z.string().max(64).optional(),
});
export const gateEventSchema = z.object({
  gate: z.string().max(64).nullable().optional(),
  // Only frontend-only signals here; claim/waitlist/upgrade have their own routes.
  action: z.enum(['shown', 'dismissed']),
});
export const setFlagSchema = z.object({
  key: z.enum(['paywall_enabled', 'founding_member_cap']),
  value: z.record(z.any()),
});

// ---- user-facing -----------------------------------------------------------

export async function status(req, res) {
  res.json(await billing.billingStatus(req.user.id));
}

export async function claimFounding(req, res) {
  const result = await billing.claimFounding(req.user.id);
  if (result.slotsExhausted) return res.status(409).json({ ok: false, slotsExhausted: true });
  res.json({ ok: true, ...result });
}

export async function joinWaitlist(req, res) {
  res.json(await billing.joinWaitlist(req.user.id, {
    interestedTier: req.body.interested_tier,
    sourceGate: req.body.source_gate,
  }));
}

export async function gateEvent(req, res) {
  res.json(await billing.logGateEvent(req.user.id, { gate: req.body.gate, action: req.body.action }));
}

/**
 * Real-checkout stub. Unreachable in fake-door mode (guarded on both flags), and
 * even when reachable it 501s until Stripe is wired.
 */
export async function checkout(req, res) {
  const paywall = await billing.getFlag('paywall_enabled');
  if (!env.billingEnabled || !paywall?.enabled) {
    throw new AppError(403, 'Checkout is not available yet.', { code: 'checkout_disabled' });
  }
  // TODO(stripe): create a Checkout Session for req.body.tier + billing period and
  // return its URL. Wire the webhook to set users.tier / pro_until on success.
  return res.status(501).json({
    error: { message: 'Checkout is not implemented yet.', details: { code: 'checkout_not_implemented' } },
  });
}

// ---- admin -----------------------------------------------------------------

export async function adminFlags(req, res) {
  res.json({
    paywall_enabled: await billing.getFlag('paywall_enabled'),
    founding_member_cap: await billing.getFlag('founding_member_cap'),
    billing_enabled: env.billingEnabled,
  });
}

export async function adminSetFlag(req, res) {
  const row = await billing.setFlag(req.body.key, req.body.value, req.user.id);
  res.json({ ok: true, flag: row });
}

export async function adminFounding(req, res) {
  res.json({
    cap: await billing.foundingCap(),
    claimed: await billing.foundingClaimedCount(),
    members: await billing.listFoundingMembers(),
  });
}

export async function adminWaitlist(req, res) {
  const rows = await billing.listWaitlist();
  res.json({ count: rows.length, entries: rows });
}

export async function adminWaitlistCsv(req, res) {
  const rows = await billing.listWaitlist();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'name,email,interested_tier,source_gate,created_at';
  const body = rows.map((r) => [r.name, r.email, r.interested_tier, r.source_gate, r.created_at].map(esc).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="summit-waitlist.csv"');
  res.send(`${header}\n${body}\n`);
}

export async function adminGateAnalytics(req, res) {
  const { from, to } = req.query;
  res.json({ gates: await billing.gateAnalytics({ from, to }) });
}
