import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/config/db.js';
import * as del from '../src/services/accountDeletion.service.js';
import { login } from '../src/services/auth.service.js';

// These tests exercise the soft-delete / restore / purge service against a real
// DB. They skip cleanly when no database is reachable (mirrors registration.test).

let dbReady = false;
const userIds = [];
const institutionIds = [];
const DAY_MS = 24 * 60 * 60 * 1000;

async function mkUser({ password = 'Password123', institutionId = null } = {}) {
  const email = `del_${Math.random().toString(36).slice(2)}@ex.com`;
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, email_verified, institution_id)
     VALUES ($1, $2, 'Test', true, $3) RETURNING id, email`,
    [email, hash, institutionId],
  );
  userIds.push(rows[0].id);
  return { id: rows[0].id, email: rows[0].email, password };
}

async function mkInstitution() {
  const { rows } = await query(
    `INSERT INTO institutions (name, admin_email) VALUES ('Test University', 'admin@test.edu') RETURNING id`,
  );
  institutionIds.push(rows[0].id);
  return rows[0].id;
}

// Force a pending-deletion account's deleted_at into the past to simulate an
// expired (or still-within) grace window.
const setDeletedDaysAgo = (id, days) =>
  query(
    `UPDATE users SET deleted_at = now() - ($2 || ' days')::interval, account_status = 'pending_deletion' WHERE id = $1`,
    [id, String(days)],
  );

before(async () => {
  try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; }
});
after(async () => {
  if (dbReady) {
    if (userIds.length) {
      await query('DELETE FROM audit_logs WHERE target_id = ANY($1::text[])', [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]).catch(() => {});
    }
    if (institutionIds.length) {
      await query('DELETE FROM institutions WHERE id = ANY($1::uuid[])', [institutionIds]).catch(() => {});
    }
  }
  await pool.end().catch(() => {});
});

/* ---- requestAccountDeletion (re-auth + confirmation gates) -------------- */

test('institutional accounts cannot self-delete', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const instId = await mkInstitution();
  const u = await mkUser({ institutionId: instId });
  await assert.rejects(
    () => del.requestAccountDeletion(u.id, { password: u.password, confirmEmail: u.email }),
    /managed by your institution/i,
  );
  const { rows } = await query('SELECT deleted_at FROM users WHERE id = $1', [u.id]);
  assert.equal(rows[0].deleted_at, null); // untouched
});

test('wrong confirmation email is rejected (no state change)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const u = await mkUser();
  await assert.rejects(
    () => del.requestAccountDeletion(u.id, { password: u.password, confirmEmail: 'someone@else.com' }),
    /type your email/i,
  );
  const { rows } = await query('SELECT deleted_at FROM users WHERE id = $1', [u.id]);
  assert.equal(rows[0].deleted_at, null);
});

test('wrong password is rejected (no state change)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const u = await mkUser();
  await assert.rejects(
    () => del.requestAccountDeletion(u.id, { password: 'wrong-password', confirmEmail: u.email }),
    /password is incorrect/i,
  );
  const { rows } = await query('SELECT deleted_at FROM users WHERE id = $1', [u.id]);
  assert.equal(rows[0].deleted_at, null);
});

test('valid request soft-deletes and revokes all sessions', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const u = await mkUser();
  // Give the account a live refresh token; it must be revoked by the request.
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id)
     VALUES ($1, $2, now() + interval '1 day', gen_random_uuid())`,
    [u.id, 'hash_' + Math.random().toString(36).slice(2)],
  );

  const { scheduledFor } = await del.requestAccountDeletion(u.id, { password: u.password, confirmEmail: u.email.toUpperCase() });

  const { rows } = await query('SELECT deleted_at, account_status, sessions_invalidated_at FROM users WHERE id = $1', [u.id]);
  assert.ok(rows[0].deleted_at, 'deleted_at set');
  assert.equal(rows[0].account_status, 'pending_deletion');
  assert.ok(rows[0].sessions_invalidated_at, 'session watermark bumped');
  // ~30 days out.
  const days = (new Date(scheduledFor) - new Date(rows[0].deleted_at)) / DAY_MS;
  assert.ok(days > 29.9 && days < 30.1, `scheduledFor ~30d out (got ${days})`);

  const live = await query('SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
  assert.equal(live.rows[0].n, 0, 'all refresh tokens revoked');
});

/* ---- login gate + restore ---------------------------------------------- */

test('login on a pending-deletion account returns a restore challenge (no session)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const u = await mkUser();
  await del.requestAccountDeletion(u.id, { password: u.password, confirmEmail: u.email });

  const res = await login({ email: u.email, password: u.password });
  assert.equal(res.pendingDeletion, true);
  assert.ok(res.restoreToken, 'restore token issued');
  assert.equal(res.user, undefined, 'no user/session handed out');
  assert.equal(res.accessToken, undefined);
});

test('restoreAccount reactivates; second restore is rejected', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const u = await mkUser();
  await del.requestAccountDeletion(u.id, { password: u.password, confirmEmail: u.email });

  const { user } = await del.restoreAccount(u.id);
  assert.equal(user.pendingDeletion, false);
  const { rows } = await query('SELECT deleted_at, account_status FROM users WHERE id = $1', [u.id]);
  assert.equal(rows[0].deleted_at, null);
  assert.equal(rows[0].account_status, 'active');

  // Nothing left to restore.
  await assert.rejects(() => del.restoreAccount(u.id), /no longer be restored/i);

  // And a normal login now issues a real session again.
  const res = await login({ email: u.email, password: u.password });
  assert.ok(res.accessToken, 'session restored');
  assert.equal(res.pendingDeletion, undefined);
});

/* ---- purgeExpiredAccounts ---------------------------------------------- */

test('purge removes only past-grace accounts and ALL their data', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const expired = await mkUser();
  const recent = await mkUser();

  // Seed owned data across cascade + explicit-delete tables for the expired user.
  await query('INSERT INTO classes (user_id, name) VALUES ($1, $2)', [expired.id, 'Purge Me 101']);
  await query('INSERT INTO security_events (user_id, action, outcome) VALUES ($1, $2, $3)', [expired.id, 'login', 'success']);
  await query('INSERT INTO gate_events (user_id, action) VALUES ($1, $2)', [expired.id, 'shown']);
  await query('INSERT INTO audit_logs (actor_user_id, action) VALUES ($1, $2)', [expired.id, 'record.view']);
  await query('INSERT INTO audit_logs (subject_student_id, action) VALUES ($1, $2)', [expired.id, 'record.export']);

  await setDeletedDaysAgo(expired.id, 31); // past the 30-day grace
  await setDeletedDaysAgo(recent.id, 5);   // still recoverable

  const purged = await del.purgeExpiredAccounts();
  const purgedIds = purged.map((p) => p.id);
  assert.ok(purgedIds.includes(expired.id), 'expired account purged');
  assert.ok(!purgedIds.includes(recent.id), 'recent account left alone');

  // Expired user + every owned row gone.
  assert.equal((await query('SELECT count(*)::int n FROM users WHERE id = $1', [expired.id])).rows[0].n, 0);
  assert.equal((await query('SELECT count(*)::int n FROM classes WHERE user_id = $1', [expired.id])).rows[0].n, 0, 'classes cascade-deleted');
  assert.equal((await query('SELECT count(*)::int n FROM security_events WHERE user_id = $1', [expired.id])).rows[0].n, 0, 'security_events deleted');
  assert.equal((await query('SELECT count(*)::int n FROM gate_events WHERE user_id = $1', [expired.id])).rows[0].n, 0, 'gate_events deleted');
  assert.equal(
    (await query('SELECT count(*)::int n FROM audit_logs WHERE actor_user_id = $1 OR subject_student_id = $1', [expired.id])).rows[0].n,
    0,
    'user audit_logs deleted',
  );

  // The purge itself is recorded to the admin audit trail.
  const rec = await query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'account.purge' AND target_id = $1`, [expired.id]);
  assert.equal(rec.rows[0].n, 1, 'purge recorded to audit trail');

  // Recent (within grace) account still present + still pending.
  const recentRow = await query('SELECT account_status FROM users WHERE id = $1', [recent.id]);
  assert.equal(recentRow.rows[0].account_status, 'pending_deletion');
});
