import { z } from 'zod';
import * as analytics from '../services/admin.service.js';
import * as gating from '../services/featureGating.service.js';
import * as canvasConfig from '../services/canvasConfig.service.js';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export async function overview(req, res) {
  res.json(await analytics.overview());
}

/* ---- Canvas configuration (admin) --------------------------------------- */

export const canvasConfigSchema = z.object({
  instanceUrl: z.string().trim().max(300).optional(),
  clientId: z.string().trim().max(300).optional(),
  // Empty/omitted secret means "keep the stored one".
  clientSecret: z.string().max(500).optional(),
  // Only accepted when none is set yet (write-once); must be 64 hex chars.
  encryptionKey: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be 64 hexadecimal characters').optional(),
});

export async function getCanvasConfig(req, res) {
  res.json({ config: await canvasConfig.getPublicConfig() });
}

export async function saveCanvasConfig(req, res) {
  res.json({ config: await canvasConfig.saveConfig(req.body) });
}
export async function signups(req, res) {
  res.json(await analytics.signups());
}
export async function referrals(req, res) {
  res.json(await analytics.referrals());
}
export async function activity(req, res) {
  res.json(await analytics.activity());
}
export async function lms(req, res) {
  res.json(await analytics.lms());
}

// ---- Premium whitelist (admin only) ----------------------------------------

export const whitelistAddSchema = z
  .object({
    email: z.string().email().toLowerCase().optional(),
    userId: z.string().uuid().optional(),
    reason: z.string().max(300).optional(),
  })
  .refine((o) => o.email || o.userId, { message: 'email or userId is required' });
export const whitelistRemoveSchema = z
  .object({ email: z.string().email().toLowerCase().optional(), userId: z.string().uuid().optional() })
  .refine((o) => o.email || o.userId, { message: 'email or userId is required' });

/** Resolve an {email|userId} body to a user id, or 404. */
async function resolveUserId({ email, userId }) {
  if (userId) {
    const { rows } = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw AppError.notFound('No user with that id.');
    return rows[0].id;
  }
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (!rows[0]) throw AppError.notFound('No user with that email.');
  return rows[0].id;
}

export async function whitelistAdd(req, res) {
  const userId = await resolveUserId(req.body);
  await gating.addToWhitelist({ userId, reason: req.body.reason, whitelistedBy: req.user.id });
  res.status(201).json({ success: true, entry: (await gating.listWhitelist()).find((w) => w.userId === userId) });
}

export async function whitelistRemove(req, res) {
  const userId = await resolveUserId(req.body);
  const removed = await gating.removeFromWhitelist(userId);
  res.json({ success: true, removed });
}

export async function whitelistList(req, res) {
  res.json({ whitelisted: await gating.listWhitelist() });
}

/**
 * First-admin bootstrap. NOT behind auth — it's how the very first admin is
 * created. Guarded by the SETUP_TOKEN env (disabled if unset) and self-disables
 * once any admin exists. Promotes an existing user (by email) to admin.
 */
export async function bootstrap(req, res) {
  const token = req.get('x-setup-token') || req.query.token;
  if (!env.adminSetupToken || token !== env.adminSetupToken) {
    throw AppError.forbidden('Invalid or missing setup token.');
  }
  const { rows: admins } = await query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
  if (admins.length) throw AppError.forbidden('An admin already exists.');

  const email = req.body?.email;
  if (!email) throw AppError.badRequest('email is required.');
  const { rowCount } = await query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  if (!rowCount) throw AppError.notFound('No user with that email — sign up first, then bootstrap.');
  res.json({ ok: true, email, role: 'admin' });
}
