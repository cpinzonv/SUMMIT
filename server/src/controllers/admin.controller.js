import * as analytics from '../services/admin.service.js';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export async function overview(req, res) {
  res.json(await analytics.overview());
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
