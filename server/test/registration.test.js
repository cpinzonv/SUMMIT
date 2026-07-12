import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { registrationGate } from '../src/middleware/registrationGate.js';
import { adminOnly } from '../src/middleware/adminOnly.js';
import * as reg from '../src/services/registration.service.js';

// Drive a middleware like the app does; resolve with whatever it passes to next().
const runMw = (mw, req) => new Promise((resolve) => { mw(req, {}, (err) => resolve(err)); });
const runGate = (req) => runMw(registrationGate, req);

let dbReady = false;
const codes = [];
const emails = [];
const users = [];
const savedAllow = env.allowedEmails;

async function mkCode(opts) {
  const c = await reg.createInviteCode(opts);
  codes.push(c.code);
  return c;
}
async function mkUser(role = 'user') {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, 'x', 'T', $2) RETURNING id`,
    [`reg_${Math.random().toString(36).slice(2)}@ex.com`, role],
  );
  users.push(rows[0].id);
  return rows[0].id;
}

before(async () => {
  try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; }
});
// Each test starts invite_only with an empty allowlist unless it changes them.
beforeEach(async () => {
  if (!dbReady) return;
  await reg.setRegistrationMode('invite_only', null);
  env.allowedEmails = [];
});
after(async () => {
  env.allowedEmails = savedAllow;
  if (dbReady) await reg.setRegistrationMode('invite_only', null).catch(() => {}); // leave a sane default
  if (codes.length) await query('DELETE FROM invite_codes WHERE code = ANY($1::text[])', [codes]).catch(() => {});
  if (emails.length) await query('DELETE FROM launch_waitlist WHERE email = ANY($1::text[])', [emails]).catch(() => {});
  if (users.length) await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]).catch(() => {});
  await pool.end().catch(() => {});
});

// ---- admin-controlled mode: takes effect on the register route -------------

test('mode change via the setting takes effect on the register route (both directions)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  // open → a codeless signup passes the gate
  await reg.setRegistrationMode('open', null);
  assert.equal(await runGate({ body: { email: 'x@ex.com' } }), undefined);
  // invite_only → the same signup is rejected
  await reg.setRegistrationMode('invite_only', null);
  const err = await runGate({ body: { email: 'x@ex.com' } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('cache invalidation: a mode write is reflected on the next read (not stale)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  await reg.setRegistrationMode('open', null);
  assert.equal(await reg.getRegistrationMode(), 'open');
  await reg.setRegistrationMode('invite_only', null);
  assert.equal(await reg.getRegistrationMode(), 'invite_only');
});

test('missing setting fails closed to invite_only', async (t) => {
  if (!dbReady) return t.skip('no DB');
  await reg.setRegistrationMode('open', null); // prove it is not just the default
  await query("DELETE FROM app_settings WHERE key = 'registration_mode'");
  reg.clearRegistrationModeCache();
  assert.equal(await reg.getRegistrationMode(), 'invite_only');
  const err = await runGate({ body: { email: 'x@ex.com' } });
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('setRegistrationMode rejects invalid values (strict)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  await assert.rejects(() => reg.setRegistrationMode('bogus', null), /open.*invite_only|mode must/i);
  await assert.rejects(() => reg.setRegistrationMode('', null));
});

test('the mode PUT is admin-only (non-admin → 403, admin passes)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const userId = await mkUser('user');
  const adminId = await mkUser('admin');
  const errUser = await runMw(adminOnly, { user: { id: userId } });
  assert.equal(errUser?.statusCode, 403);
  assert.equal(await runMw(adminOnly, { user: { id: adminId } }), undefined);
});

// ---- closed-mode register rejection ----------------------------------------

test('closed mode: no invite code, not allowlisted → 403 REGISTRATION_CLOSED', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const err = await runGate({ body: { email: 'nope@ex.com' } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('closed mode: bad/unknown invite code → 403', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const err = await runGate({ body: { email: 'nope@ex.com', inviteCode: 'NOPE-XXXX' } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('closed mode: expired invite code → 403', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const c = await mkCode({ maxUses: 5, expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const err = await runGate({ body: { email: 'nope@ex.com', inviteCode: c.code } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('closed mode: exhausted invite code → 403', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const c = await mkCode({ maxUses: 1 });
  assert.equal(await reg.consumeInviteCode(c.code), true); // spend the only use
  const err = await runGate({ body: { email: 'nope@ex.com', inviteCode: c.code } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

// ---- pass-through paths -----------------------------------------------------

test('closed mode: valid invite code passes the gate (case-insensitive)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const c = await mkCode({ maxUses: 3 });
  assert.equal(await runGate({ body: { email: 'ok@ex.com', inviteCode: c.code.toLowerCase() } }), undefined);
});

test('closed mode: allowlisted email passes the gate (case-insensitive)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.allowedEmails = ['founder@school.edu'];
  assert.equal(await runGate({ body: { email: 'Founder@School.edu' } }), undefined);
});

test('open mode: any signup passes the gate (no code needed)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  await reg.setRegistrationMode('open', null);
  assert.equal(await runGate({ body: { email: 'anyone@ex.com' } }), undefined);
});

// ---- invite lifecycle -------------------------------------------------------

test('invite code: consume spends uses, exhausts, and revoke invalidates', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const c = await mkCode({ maxUses: 2 });
  assert.ok(await reg.findValidInviteCode(c.code));
  assert.equal(await reg.consumeInviteCode(c.code), true);
  assert.equal(await reg.consumeInviteCode(c.code), true);
  assert.equal(await reg.consumeInviteCode(c.code), false); // exhausted
  assert.equal(await reg.findValidInviteCode(c.code), null);

  const c2 = await mkCode({ maxUses: 5 });
  assert.ok(await reg.findValidInviteCode(c2.code));
  assert.equal(await reg.revokeInviteCode(c2.code), true);
  assert.equal(await reg.findValidInviteCode(c2.code), null); // revoked → invalid
});

test('invite code: delete removes the row entirely', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const c = await mkCode({ maxUses: 1 });
  assert.equal(await reg.deleteInviteCode(c.code), true);
  assert.equal(await reg.findValidInviteCode(c.code), null);
  const { rows } = await query('SELECT 1 FROM invite_codes WHERE code = $1', [c.code]);
  assert.equal(rows.length, 0); // gone, not just revoked
  assert.equal(await reg.deleteInviteCode(c.code), false); // idempotent — nothing left to delete
});

// ---- waitlist dedupe --------------------------------------------------------

test('waitlist: duplicate email upserts silently (one row, case-insensitive)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const email = `wl_${Math.random().toString(36).slice(2)}@ex.com`;
  emails.push(email);
  await reg.addToWaitlist({ email, university: 'State University', source: 'register_page' });
  await reg.addToWaitlist({ email: email.toUpperCase(), university: 'State University' }); // dup → silent upsert
  const { rows } = await query('SELECT count(*)::int AS n FROM launch_waitlist WHERE email = $1', [email]);
  assert.equal(rows[0].n, 1);
});
