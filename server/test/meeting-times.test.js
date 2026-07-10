import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClassSchema, updateClassSchema } from '../src/controllers/classes.controller.js';
import { meetingDaysFrom, earliestStart } from '../src/utils/meetingTimes.js';
import { createClass, updateClass } from '../src/services/class.service.js';
import { query, pool } from '../src/config/db.js';

const mt = (day, start, end) => ({ day, start, ...(end ? { end } : {}) });

// ---- Validation (zod schemas, no DB) ---------------------------------------

test('validation — a well-formed MWF schedule passes', () => {
  const parsed = createClassSchema.parse({
    name: 'CS 101',
    syllabus: { meetingTimes: [mt('Mon', '10:00', '10:50'), mt('Wed', '10:00', '10:50'), mt('Fri', '10:00', '10:50')] },
  });
  assert.equal(parsed.syllabus.meetingTimes.length, 3);
});

test('validation — end must be after start', () => {
  assert.throws(() => createClassSchema.parse({ name: 'X', syllabus: { meetingTimes: [mt('Mon', '11:00', '10:00')] } }), /after/i);
  assert.throws(() => createClassSchema.parse({ name: 'X', syllabus: { meetingTimes: [mt('Mon', '10:00', '10:00')] } }), /after/i); // equal is not after
});

test('validation — weekday must be Mon..Sun', () => {
  assert.throws(() => createClassSchema.parse({ name: 'X', syllabus: { meetingTimes: [mt('Funday', '10:00', '10:50')] } }));
  assert.throws(() => createClassSchema.parse({ name: 'X', syllabus: { meetingTimes: [mt('MON', '10:00', '10:50')] } })); // wrong case
});

test('validation — times must be HH:MM (24h)', () => {
  assert.throws(() => createClassSchema.parse({ name: 'X', syllabus: { meetingTimes: [mt('Mon', '25:00', '26:00')] } }));
  assert.throws(() => createClassSchema.parse({ name: 'X', syllabus: { meetingTimes: [mt('Mon', '9:00', '10:00')] } })); // not zero-padded
});

test('validation — nulls/omitted are fine (optional schedule)', () => {
  createClassSchema.parse({ name: 'X' }); // no schedule at all
  createClassSchema.parse({ name: 'X', syllabus: { meetingTimes: [mt('Mon', '10:00')] } }); // end omitted
  assert.ok(true);
});

test('validation — update schema accepts a rich schedule + location', () => {
  const parsed = updateClassSchema.parse({ syllabus: { meetingTimes: [mt('Tue', '09:00', '09:50')], location: 'Hall A' } });
  assert.equal(parsed.syllabus.meetingTimes[0].day, 'Tue');
  assert.throws(() => updateClassSchema.parse({ syllabus: { meetingTimes: [mt('Mon', '10:00', '09:00')] } }), /after/i);
});

// ---- Derivation (pure) -----------------------------------------------------

test('meetingDaysFrom — distinct days in first-seen order', () => {
  assert.deepEqual(meetingDaysFrom([mt('Mon', '10:00'), mt('Wed', '10:00'), mt('Mon', '14:00')]), ['Mon', 'Wed']);
  assert.deepEqual(meetingDaysFrom([]), []);
  assert.deepEqual(meetingDaysFrom(null), []);
});

test('earliestStart — smallest start time', () => {
  assert.equal(earliestStart([mt('Mon', '10:00'), mt('Wed', '09:30')]), '09:30');
  assert.equal(earliestStart([]), null);
});

// ---- DB integration: create/update derive meeting_days ---------------------

let dbReady = false;
const temp = [];
async function mkUser() {
  const { rows } = await query(
    "INSERT INTO users (email, password_hash, full_name, tier) VALUES ($1,'x','T','free') RETURNING id",
    [`mt_${Math.random().toString(36).slice(2)}@ex.com`],
  );
  temp.push(rows[0].id);
  return rows[0].id;
}
before(async () => { try { await query('SELECT 1'); dbReady = true; } catch { dbReady = false; } });
after(async () => {
  if (temp.length) await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [temp]).catch(() => {});
  await pool.end().catch(() => {});
});

test('createClass derives meeting_days + persists meeting_times', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  const cls = await createClass(uid, {
    name: 'CS 101',
    startDate: '2026-08-24',
    endDate: '2026-12-11',
    syllabus: { meetingTimes: [mt('Mon', '10:00', '10:50'), mt('Wed', '10:00', '10:50'), mt('Fri', '10:00', '10:50')], location: 'Bldg 4' },
  });
  assert.deepEqual(cls.meetingDays, ['Mon', 'Wed', 'Fri']); // derived for attendance
  assert.equal(cls.meetingTime, '10:00'); // earliest start, for the attendance display
  assert.equal(cls.syllabus.meetingTimes.length, 3);
  assert.equal(cls.syllabus.location, 'Bldg 4');
});

test('updateClass re-derives meeting_days when the schedule changes', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  const cls = await createClass(uid, { name: 'Bio', syllabus: { meetingTimes: [mt('Mon', '10:00', '10:50')] } });
  assert.deepEqual(cls.meetingDays, ['Mon']);
  const updated = await updateClass(uid, cls.id, {
    syllabus: { meetingTimes: [mt('Tue', '13:00', '14:15'), mt('Thu', '13:00', '14:15')] },
  });
  assert.deepEqual(updated.meetingDays, ['Tue', 'Thu']); // re-derived
  assert.equal(updated.meetingTime, '13:00');
  assert.equal(updated.syllabus.meetingTimes.length, 2);
});

test('class with no schedule saves cleanly (existing rows never break)', async (t) => {
  if (!dbReady) return t.skip('no DB');
  const uid = await mkUser();
  const cls = await createClass(uid, { name: 'Seminar' });
  assert.deepEqual(cls.meetingDays, []);
  assert.deepEqual(cls.syllabus.meetingTimes, []);
});
