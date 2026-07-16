import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/config/db.js';
import * as assignments from '../src/services/assignment.service.js';

/**
 * estimate_source precedence (trial UX batch): a new assignment gets a 1h
 * 'default' estimate; a value supplied at creation or edited later is 'manual';
 * and AI re-estimation NEVER overwrites a manual estimate. Runs against a real
 * Postgres (skipped when none is reachable, like the other service tests).
 */
let dbReady = false;
const userIds = [];
let classId;

before(async () => {
  try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; }
  if (!dbReady) return;
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, email_verified)
     VALUES ($1, 'x', 'Est Test', true) RETURNING id`,
    [`est_${Math.random().toString(36).slice(2)}@ex.com`],
  );
  userIds.push(rows[0].id);
  const c = await query(
    `INSERT INTO classes (user_id, name, term) VALUES ($1, 'Test Class', 'Fall 2026') RETURNING id`,
    [rows[0].id],
  );
  classId = c.rows[0].id;
});

after(async () => {
  if (dbReady && userIds.length) {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

test('new assignment without an estimate gets a 1h default', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const a = await assignments.createAssignment(userIds[0], classId, { title: 'No estimate' });
  assert.equal(a.estimatedHours, 1);
  assert.equal(a.estimateSource, 'default');
});

test('an estimate supplied at creation is treated as manual', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const a = await assignments.createAssignment(userIds[0], classId, { title: 'Preset', estimatedHours: 3 });
  assert.equal(a.estimatedHours, 3);
  assert.equal(a.estimateSource, 'manual');
});

test('editing the estimate marks it manual', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const a = await assignments.createAssignment(userIds[0], classId, { title: 'Edit me' });
  assert.equal(a.estimateSource, 'default');
  const updated = await assignments.updateAssignment(userIds[0], a.id, { estimatedHours: 2.5 });
  assert.equal(updated.estimatedHours, 2.5);
  assert.equal(updated.estimateSource, 'manual');
});

test('AI re-estimation never overwrites a manual estimate', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const a = await assignments.createAssignment(userIds[0], classId, { title: 'Manual wins' });
  await assignments.updateAssignment(userIds[0], a.id, { estimatedHours: 4 });
  // estimateTime short-circuits on a manual source — no AI call, value preserved.
  const res = await assignments.estimateTime(userIds[0], a.id, 'Some long instructions that would otherwise be estimated.');
  assert.equal(res.kept, true);
  assert.equal(res.source, 'manual');
  assert.equal(res.estimatedHours, 4);
  const after = await assignments.getAssignmentForUser(userIds[0], a.id);
  assert.equal(after.estimatedHours, 4);
  assert.equal(after.estimateSource, 'manual');
});

test('clearing the estimate clears the source', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const a = await assignments.createAssignment(userIds[0], classId, { title: 'Clear me', estimatedHours: 2 });
  const cleared = await assignments.updateAssignment(userIds[0], a.id, { estimatedHours: null });
  assert.equal(cleared.estimatedHours, null);
  assert.equal(cleared.estimateSource, null);
});
