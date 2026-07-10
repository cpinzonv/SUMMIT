import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDateFor } from '../src/config/tiers.js';
import { accountTypeOf, checkAndConsume, getTierRow } from '../src/services/usageGating.service.js';
import { logGateEvent, gateAnalytics } from '../src/services/billing.service.js';
import { query, pool } from '../src/config/db.js';

// ---- Pure: reset-date math (no DB) -----------------------------------------

test('resetDateFor — monthly → first of NEXT month', () => {
  assert.equal(resetDateFor('month', new Date(2026, 0, 15)), '2026-02-01');
  assert.equal(resetDateFor('month', new Date(2026, 11, 10)), '2027-01-01'); // Dec → Jan next year
});
test('resetDateFor — semester → next boundary (Jul 1 / Jan 1)', () => {
  assert.equal(resetDateFor('semester', new Date(2026, 2, 1)), '2026-07-01'); // Mar → Jul 1
  assert.equal(resetDateFor('semester', new Date(2026, 8, 1)), '2027-01-01'); // Sep → Jan 1 next year
});
test('resetDateFor — lifetime has no reset', () => {
  assert.equal(resetDateFor('lifetime', new Date(2026, 0, 1)), null);
});

// ---- Pure: account type resolution -----------------------------------------

const FUTURE = '2999-01-01';
test('accountTypeOf — active institution → institutional', () => {
  assert.equal(accountTypeOf({ institution_id: 'i', institution_contract_end: FUTURE }), 'institutional');
});
test('accountTypeOf — individual user → b2c', () => {
  assert.equal(accountTypeOf({ tier: 'free' }), 'b2c');
  assert.equal(accountTypeOf(null), 'b2c');
});
test('accountTypeOf — revoked / expired institution → b2c (no longer institutional)', () => {
  assert.equal(accountTypeOf({ institution_id: 'i', institution_revoked_at: '2020-01-01' }), 'b2c');
  assert.equal(accountTypeOf({ institution_id: 'i', institution_contract_end: '2020-01-01' }), 'b2c');
});

// ---- DB integration --------------------------------------------------------

let dbReady = false;
const temp = [];
const tempInst = [];
async function mkUser(overrides = {}) {
  const cols = { email: `qn_${Math.random().toString(36).slice(2)}@ex.com`, password_hash: 'x', full_name: 'T', tier: 'free', ...overrides };
  const keys = Object.keys(cols);
  const { rows } = await query(
    `INSERT INTO users (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    keys.map((k) => cols[k]),
  );
  temp.push(rows[0].id);
  return rows[0].id;
}
async function mkInstitution(name = 'Riverside University') {
  const { rows } = await query(
    "INSERT INTO institutions (name, admin_email, contract_end) VALUES ($1,'it@test.edu',(now()+interval '1 year')::date) RETURNING id",
    [name],
  );
  tempInst.push(rows[0].id);
  return rows[0].id;
}

before(async () => { try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; } });
after(async () => {
  if (temp.length) await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [temp]).catch(() => {});
  if (tempInst.length) await query('DELETE FROM institutions WHERE id = ANY($1::uuid[])', [tempInst]).catch(() => {});
  await pool.end().catch(() => {});
});

test('institutional student over Pro cap → 402 account_type institutional + name + reset_date', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const instId = await mkInstitution('Riverside University');
  const uid = await mkUser({ institution_id: instId });
  // Institution → effective Pro: 3 podcasts/month, then blocked.
  assert.equal((await checkAndConsume(uid, 'podcasts')).allowed, true);
  assert.equal((await checkAndConsume(uid, 'podcasts')).allowed, true);
  assert.equal((await checkAndConsume(uid, 'podcasts')).allowed, true);
  const blocked = await checkAndConsume(uid, 'podcasts');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.account_type, 'institutional');
  assert.equal(blocked.institution_name, 'Riverside University');
  assert.equal(blocked.reset_date, resetDateFor('month')); // podcasts are monthly
});

test('b2c student over free cap → 402 account_type b2c (never institutional)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  assert.equal((await checkAndConsume(uid, 'podcasts')).allowed, true); // free: 1/mo
  const blocked = await checkAndConsume(uid, 'podcasts');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.account_type, 'b2c');
  assert.equal(blocked.institution_name, null);
});

test('getTierRow carries institution_name for institutional users', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const instId = await mkInstitution('Lakeside College');
  const uid = await mkUser({ institution_id: instId });
  const row = await getTierRow(uid);
  assert.equal(row.institution_name, 'Lakeside College');
  assert.equal(accountTypeOf(row), 'institutional');
});

test('gate_events carry account_type; analytics splits b2c vs institutional', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const gate = `split_${Math.random().toString(36).slice(2)}`;
  const b2c = await mkUser();
  const instId = await mkInstitution();
  const inst = await mkUser({ institution_id: instId });
  await logGateEvent(b2c, { gate, action: 'shown', tierAtTime: 'free', accountType: 'b2c' });
  await logGateEvent(b2c, { gate, action: 'shown', tierAtTime: 'free', accountType: 'b2c' });
  await logGateEvent(inst, { gate, action: 'shown', tierAtTime: 'pro', accountType: 'institutional' });

  // stored on the row
  const { rows } = await query('SELECT account_type, count(*)::int n FROM gate_events WHERE gate=$1 GROUP BY account_type', [gate]);
  const byType = Object.fromEntries(rows.map((r) => [r.account_type, r.n]));
  assert.equal(byType.b2c, 2);
  assert.equal(byType.institutional, 1);

  // surfaced in analytics
  const g = (await gateAnalytics()).find((x) => x.gate === gate);
  assert.equal(g.b2c, 2);
  assert.equal(g.institutional, 1);
  assert.equal(g.total, 3);
});
