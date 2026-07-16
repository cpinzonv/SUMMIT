import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/config/db.js';
import * as auth from '../src/services/auth.service.js';
import * as authController from '../src/controllers/auth.controller.js';

/**
 * Server-side session revocation on logout. These run against a real Postgres
 * (skipped when none is reachable, like registration.test.js). They exercise the
 * refresh-token revocation the logout flow relies on: a revoked token can no
 * longer be rotated, per-device logout is isolated, "log out everywhere" clears
 * everything, password change ends other sessions but keeps the current one, and
 * "log out everywhere" requires re-authentication.
 */

let dbReady = false;
const userIds = [];

async function mkUser(password = 'Sup3rSecret!') {
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, email_verified)
     VALUES ($1, $2, 'Test', true) RETURNING id`,
    [`sess_${Math.random().toString(36).slice(2)}@ex.com`, hash],
  );
  userIds.push(rows[0].id);
  return rows[0].id;
}

/** True when refreshing this token is rejected (revoked/expired → 401). */
async function refreshRejected(refreshToken) {
  try {
    await auth.refresh({ refreshToken });
    return false;
  } catch (err) {
    return err?.statusCode === 401;
  }
}

/** Minimal Express res double for driving controllers directly. */
function mockRes() {
  const r = { statusCode: 200, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

before(async () => {
  try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; }
});
after(async () => {
  if (dbReady && userIds.length) {
    await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => {});
    await query('DELETE FROM trusted_devices WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => {});
    await query('DELETE FROM security_events WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => {});
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

test('a refresh token is dead after logout on that device (refresh → 401)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  const { refreshToken } = await auth.issueTokensForUser(uid);

  // logout reports the owning user (for the audit log) and revokes the token.
  const { userId } = await auth.logout({ refreshToken });
  assert.equal(userId, uid);

  assert.ok(await refreshRejected(refreshToken), 'refresh after logout must be rejected');
});

test('logging out one device leaves the other device signed in', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  const a = await auth.issueTokensForUser(uid);
  const b = await auth.issueTokensForUser(uid);

  await auth.logout({ refreshToken: a.refreshToken });

  assert.ok(await refreshRejected(a.refreshToken), 'device A must be logged out');
  const rotatedB = await auth.refresh({ refreshToken: b.refreshToken });
  assert.ok(rotatedB.refreshToken, 'device B must still refresh');
});

test('log out everywhere kills every session, clears trusted devices, stamps the watermark', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  const a = await auth.issueTokensForUser(uid);
  const b = await auth.issueTokensForUser(uid);
  await query(
    `INSERT INTO trusted_devices (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 days')`,
    [uid, `dev_${Math.random().toString(36).slice(2)}`],
  );

  await auth.logoutAll(uid);

  assert.ok(await refreshRejected(a.refreshToken), 'device A killed');
  assert.ok(await refreshRejected(b.refreshToken), 'device B killed');

  const td = await query('SELECT revoked_at FROM trusted_devices WHERE user_id = $1', [uid]);
  assert.ok(td.rows.length && td.rows.every((r) => r.revoked_at !== null), 'trusted devices revoked');

  const u = await query('SELECT sessions_invalidated_at FROM users WHERE id = $1', [uid]);
  assert.ok(u.rows[0].sessions_invalidated_at !== null, 'access-token watermark stamped');
});

test('changing the password ends other sessions but keeps the changing one', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser('OldPass123');
  const other = await auth.issueTokensForUser(uid);

  const fresh = await auth.changePassword(uid, 'OldPass123', 'NewPass456', {});
  assert.ok(fresh.accessToken && fresh.refreshToken, 'a fresh pair is returned for the current session');

  // The current session (the returned pair) keeps working…
  const rotated = await auth.refresh({ refreshToken: fresh.refreshToken });
  assert.ok(rotated.refreshToken, 'current session stays signed in');
  // …while the other device is signed out.
  assert.ok(await refreshRejected(other.refreshToken), 'other device signed out');

  // A wrong current password changes nothing.
  await assert.rejects(() => auth.changePassword(uid, 'WRONG', 'Whatever789', {}), /incorrect/i);
});

test('log out everywhere requires the correct current password (re-auth)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser('Right0nePass');
  const session = await auth.issueTokensForUser(uid);

  // Wrong password → the endpoint rejects and touches no sessions.
  await assert.rejects(
    () => authController.logoutAll({ user: { id: uid }, body: { password: 'nope' }, ip: '1.1.1.1' }, mockRes()),
    /incorrect/i,
  );
  const stillAlive = await auth.refresh({ refreshToken: session.refreshToken });
  assert.ok(stillAlive.refreshToken, 're-auth failure must not revoke sessions');

  // Correct password → succeeds and revokes everything.
  const res = mockRes();
  await authController.logoutAll({ user: { id: uid }, body: { password: 'Right0nePass' }, ip: '1.1.1.1' }, res);
  assert.deepEqual(res.body, { ok: true });
  assert.ok(await refreshRejected(stillAlive.refreshToken), 'sessions revoked after re-auth');
});
