import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTier, checkAndConsume, getTierRow } from '../src/services/usageGating.service.js';
import { claimFounding, foundingClaimedCount, foundingCap, setFlag } from '../src/services/billing.service.js';
import { query, pool } from '../src/config/db.js';

// ---- Pure: effective tier resolution (no DB) -------------------------------

test('effectiveTier — admin/demo → max', () => {
  assert.equal(effectiveTier({ role: 'admin', tier: 'free' }), 'max');
  assert.equal(effectiveTier({ role: 'demo', tier: 'free' }), 'max');
});
test('effectiveTier — premium whitelist → pro (preserves old behavior)', () => {
  assert.equal(effectiveTier({ role: 'user', tier: 'free', is_whitelisted: true }), 'pro');
});
test('effectiveTier — founding with active pro_until → pro', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(effectiveTier({ role: 'user', tier: 'free', founding_member: true, pro_until: future }), 'pro');
});
test('effectiveTier — founding with EXPIRED pro_until → falls back to users.tier', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(effectiveTier({ role: 'user', tier: 'free', founding_member: true, pro_until: past }), 'free');
});
test('effectiveTier — plain tier passthrough', () => {
  assert.equal(effectiveTier({ role: 'user', tier: 'pro' }), 'pro');
  assert.equal(effectiveTier({ role: 'user', tier: 'max' }), 'max');
  assert.equal(effectiveTier(null), 'free');
});

// ---- DB integration --------------------------------------------------------

let dbReady = false;
const temp = [];
async function mkUser(overrides = {}) {
  const cols = { email: `test_${Math.random().toString(36).slice(2)}@ex.com`, password_hash: 'x', full_name: 'T', tier: 'free', ...overrides };
  const keys = Object.keys(cols);
  const { rows } = await query(
    `INSERT INTO users (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    keys.map((k) => cols[k]),
  );
  temp.push(rows[0].id);
  return rows[0].id;
}

before(async () => {
  try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; }
});
after(async () => {
  if (temp.length) await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [temp]).catch(() => {});
  await pool.end().catch(() => {});
});

test('checkAndConsume — FREE extraction: 2 allowed, 3rd blocked (402 shape)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  assert.equal((await checkAndConsume(uid, 'extraction')).allowed, true);
  assert.equal((await checkAndConsume(uid, 'extraction')).allowed, true);
  const blocked = await checkAndConsume(uid, 'extraction');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.gate, 'extraction');
  assert.equal(blocked.requiredTier, 'pro');
  assert.equal(blocked.limit, 2);
});

test('checkAndConsume — atomic rollback: over-limit consume does NOT increment', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  assert.deepEqual((await checkAndConsume(uid, 'ai_cards', 40)).remaining, 10);
  const over = await checkAndConsume(uid, 'ai_cards', 20); // would hit 60 > 50
  assert.equal(over.allowed, false);
  assert.equal(over.used, 40); // rolled back — still 40, not 60
  assert.equal((await checkAndConsume(uid, 'ai_cards', 5)).remaining, 5); // fits into 45
});

test('checkAndConsume — PRO (via whitelist) bypasses free caps', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  await query('INSERT INTO premium_whitelist (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [uid]);
  assert.equal(effectiveTier(await getTierRow(uid)), 'pro');
  for (let i = 0; i < 5; i += 1) assert.equal((await checkAndConsume(uid, 'extraction')).allowed, true); // unlimited on pro
});

test('checkAndConsume — expired founding member falls back to FREE limits', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const past = new Date(Date.now() - 86400000).toISOString();
  const uid = await mkUser({ founding_member: true, pro_until: past });
  assert.equal(effectiveTier(await getTierRow(uid)), 'free');
  await checkAndConsume(uid, 'extraction');
  await checkAndConsume(uid, 'extraction');
  assert.equal((await checkAndConsume(uid, 'extraction')).allowed, false); // free cap applies
});

test('checkAndConsume — premium voice on non-max → premium_voice gate (Max)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  const r = await checkAndConsume(uid, 'podcasts', 1, { premiumVoice: true });
  assert.equal(r.allowed, false);
  assert.equal(r.gate, 'premium_voice');
  assert.equal(r.requiredTier, 'max');
});

test('founding cap race — concurrent claims never exceed the cap', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const origCap = await foundingCap();
  const base = await foundingClaimedCount();
  const slots = 3;
  await setFlag('founding_member_cap', { cap: base + slots });
  try {
    const users = await Promise.all(Array.from({ length: 6 }, () => mkUser()));
    const results = await Promise.all(users.map((u) => claimFounding(u)));
    const granted = results.filter((r) => r.founding_member_number).length;
    const finalCount = await foundingClaimedCount();
    assert.equal(granted, slots, 'exactly the available slots are granted');
    assert.ok(finalCount <= base + slots, 'founding count never exceeds cap');
  } finally {
    await setFlag('founding_member_cap', { cap: origCap });
  }
});
