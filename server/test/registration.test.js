import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { registrationGate } from '../src/middleware/registrationGate.js';
import * as reg from '../src/services/registration.service.js';

// Drive the gate like the app does; resolve with whatever it passes to next().
function runGate(req) {
  return new Promise((resolve) => { registrationGate(req, {}, (err) => resolve(err)); });
}

let dbReady = false;
const codes = [];
const emails = [];
const savedMode = env.registrationMode;
const savedAllow = env.allowedEmails;

async function mkCode(opts) {
  const c = await reg.createInviteCode(opts);
  codes.push(c.code);
  return c;
}

before(async () => {
  try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; }
});
after(async () => {
  env.registrationMode = savedMode;
  env.allowedEmails = savedAllow;
  if (codes.length) await query('DELETE FROM invite_codes WHERE code = ANY($1::text[])', [codes]).catch(() => {});
  if (emails.length) await query('DELETE FROM launch_waitlist WHERE email = ANY($1::text[])', [emails]).catch(() => {});
  await pool.end().catch(() => {});
});

// ---- closed-mode register rejection ----------------------------------------

test('closed mode: no invite code, not allowlisted → 403 REGISTRATION_CLOSED', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.registrationMode = 'invite_only';
  env.allowedEmails = [];
  const err = await runGate({ body: { email: 'nope@ex.com' } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('closed mode: bad/unknown invite code → 403', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.registrationMode = 'invite_only';
  env.allowedEmails = [];
  const err = await runGate({ body: { email: 'nope@ex.com', inviteCode: 'NOPE-XXXX' } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('closed mode: expired invite code → 403', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.registrationMode = 'invite_only';
  env.allowedEmails = [];
  const c = await mkCode({ maxUses: 5, expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const err = await runGate({ body: { email: 'nope@ex.com', inviteCode: c.code } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

test('closed mode: exhausted invite code → 403', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.registrationMode = 'invite_only';
  env.allowedEmails = [];
  const c = await mkCode({ maxUses: 1 });
  assert.equal(await reg.consumeInviteCode(c.code), true); // spend the only use
  const err = await runGate({ body: { email: 'nope@ex.com', inviteCode: c.code } });
  assert.equal(err?.statusCode, 403);
  assert.equal(err?.details?.code, 'REGISTRATION_CLOSED');
});

// ---- pass-through paths -----------------------------------------------------

test('closed mode: valid invite code passes the gate', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.registrationMode = 'invite_only';
  env.allowedEmails = [];
  const c = await mkCode({ maxUses: 3 });
  const err = await runGate({ body: { email: 'ok@ex.com', inviteCode: c.code.toLowerCase() } }); // codes are case-insensitive
  assert.equal(err, undefined);
});

test('closed mode: allowlisted email passes the gate (case-insensitive)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.registrationMode = 'invite_only';
  env.allowedEmails = ['founder@school.edu'];
  const err = await runGate({ body: { email: 'Founder@School.edu' } });
  assert.equal(err, undefined);
});

test('open mode: any signup passes the gate (no code needed)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  env.registrationMode = 'open';
  env.allowedEmails = [];
  const err = await runGate({ body: { email: 'anyone@ex.com' } });
  assert.equal(err, undefined);
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
