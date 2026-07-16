import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSchedules, scoreSchedule, compromises, prefsActive, WEIGHTS } from './scheduleScore.js';

// section factory: days as a space-separated token string
const S = (courseCode, sectionNumber, days, startTime, endTime, extra = {}) => ({
  courseCode,
  sectionNumber,
  days: days ? days.split(/\s+/) : [],
  startTime,
  endTime,
  ...extra,
});
// rankSchedules preserves the schedule array reference, so we identify by ===.
const order = (ranked) => ranked.map((r) => r.schedule);

/* --------------------------------------------------------- no preferences */

test('no preferences → stable solver order, zero scores, null tiers', () => {
  const a = [S('A', '1', 'Mon', '09:00', '09:50')];
  const b = [S('B', '1', 'Tue', '11:00', '11:50')];
  const c = [S('C', '1', 'Wed', '13:00', '13:50')];
  const ranked = rankSchedules([a, b, c], {});
  assert.deepEqual(order(ranked), [a, b, c]); // untouched
  assert.ok(ranked.every((r) => r.score === 0 && r.tier === null && r.compromises.length === 0));
  assert.equal(prefsActive({}), false);
});

/* ------------------------------------------------------ earliest / latest */

test('earliestStart ranks a later-starting schedule above an early one', () => {
  const early = [S('A', '1', 'Mon Wed', '09:00', '09:50')];
  const late = [S('A', '2', 'Mon Wed', '11:00', '11:50')];
  const ranked = rankSchedules([early, late], { earliestStart: '10:00' });
  assert.equal(ranked[0].schedule, late);
  assert.ok(ranked.find((r) => r.schedule === early).score < 0); // penalized, not excluded
});

test('a 9:50 start when 10:00 was asked ranks low but is not excluded', () => {
  const nearMiss = [S('A', '1', 'Mon', '09:50', '10:40')];
  const clean = [S('A', '2', 'Mon', '10:00', '10:50')];
  const ranked = rankSchedules([nearMiss, clean], { earliestStart: '10:00' });
  assert.equal(ranked[0].schedule, clean);
  assert.equal(ranked.length, 2); // near-miss still present
  assert.ok(ranked.find((r) => r.schedule === nearMiss).score < 0);
});

test('latestEnd ranks an earlier-ending schedule above a late one', () => {
  const late = [S('A', '1', 'Tue', '18:00', '20:30')];
  const early = [S('A', '2', 'Tue', '13:00', '14:15')];
  const ranked = rankSchedules([late, early], { latestEnd: '17:00' });
  assert.equal(ranked[0].schedule, early);
});

/* ---------------------------------------------------------------- days free */

test('daysFree ranks a schedule that frees the requested day higher', () => {
  const busyFri = [S('A', '1', 'Mon Fri', '10:00', '10:50')];
  const freeFri = [S('A', '2', 'Mon Wed', '10:00', '10:50')];
  const ranked = rankSchedules([busyFri, freeFri], { daysFree: ['Fri'] });
  assert.equal(ranked[0].schedule, freeFri);
});

/* -------------------------------------------------------------- gap style */

test('gapStyle minimize prefers back-to-back over a big gap', () => {
  const tight = [S('A', '1', 'Mon', '10:00', '10:50'), S('B', '1', 'Mon', '10:50', '11:40')];
  const gappy = [S('A', '1', 'Mon', '10:00', '10:50'), S('B', '2', 'Mon', '14:00', '14:50')];
  const ranked = rankSchedules([gappy, tight], { gapStyle: 'minimize' });
  assert.equal(ranked[0].schedule, tight);
});

test('gapStyle spread prefers the schedule with more breathing room', () => {
  const tight = [S('A', '1', 'Mon', '10:00', '10:50'), S('B', '1', 'Mon', '10:50', '11:40')];
  const gappy = [S('A', '1', 'Mon', '10:00', '10:50'), S('B', '2', 'Mon', '14:00', '14:50')];
  const ranked = rankSchedules([tight, gappy], { gapStyle: 'spread' });
  assert.equal(ranked[0].schedule, gappy);
});

/* ------------------------------------------------------------ campus days */

test('fewerDays prefers a schedule packed into fewer days', () => {
  const twoDays = [S('A', '1', 'Mon Wed', '10:00', '10:50')];
  const fourDays = [S('A', '2', 'Mon Tue Wed Thu', '10:00', '10:50')];
  const ranked = rankSchedules([fourDays, twoDays], { fewerDays: true });
  assert.equal(ranked[0].schedule, twoDays);
});

/* -------------------------------------------------------------- professors */

test('a preferred professor lifts an otherwise-equal schedule', () => {
  const good = [S('A', '1', 'Mon', '10:00', '10:50', { professor: 'Dr. Ramirez' })];
  const plain = [S('A', '2', 'Mon', '10:00', '10:50', { professor: 'Dr. Chen' })];
  const ranked = rankSchedules([plain, good], { professors: { 'Dr. Ramirez': 'prefer' } });
  assert.equal(ranked[0].schedule, good);
});

test('an avoided professor is outranked by an otherwise-worse schedule without them', () => {
  // A violates the 10:00 earliest-start (MWF at 9:00) — clearly "worse" on time.
  // B is time-perfect but taught by an avoided professor. B must still rank below A.
  const worseButClean = [S('A', '1', 'Mon Wed Fri', '09:00', '09:50', { professor: 'Dr. Okay' })];
  const idealButAvoided = [S('A', '2', 'Mon Wed Fri', '11:00', '11:50', { professor: 'Dr. Nope' })];
  const prefs = { earliestStart: '10:00', professors: { 'Dr. Nope': 'avoid' } };
  const ranked = rankSchedules([idealButAvoided, worseButClean], prefs);
  assert.equal(ranked[0].schedule, worseButClean);
  assert.ok(ranked.find((r) => r.schedule === idealButAvoided).score < ranked.find((r) => r.schedule === worseButClean).score);
});

/* ---------------------------------------------------------------- chips */

test('compromise chips name the tradeoffs, marking heavy ones', () => {
  const cand = [S('A', '1', 'Mon Fri', '08:00', '08:50', { professor: 'Dr. Nope' })];
  const prefs = { earliestStart: '10:00', daysFree: ['Fri'], professors: { 'Dr. Nope': 'avoid' } };
  const chips = compromises(cand, prefs);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.some((l) => /Starts .* Mon/.test(l))); // earliest-start violation (earliest day)
  assert.ok(labels.some((l) => /Fri on campus/.test(l))); // days-free violation
  assert.ok(chips.some((c) => /avoided/.test(c.label) && c.heavy)); // avoided professor, heavy
});

test('a schedule that meets every preference has no compromise chips → great tier', () => {
  const cand = [S('A', '1', 'Mon Wed', '10:00', '10:50', { professor: 'Dr. Yes' })];
  const prefs = { earliestStart: '09:00', daysFree: ['Fri'], professors: { 'Dr. Yes': 'prefer' } };
  const ranked = rankSchedules([cand], prefs);
  assert.equal(ranked[0].compromises.length, 0);
  assert.equal(ranked[0].tier, 'great');
});

/* ------------------------------------------------------------- determinism */

test('equal scores keep the solver order (stable tie-break)', () => {
  const a = [S('A', '1', 'Mon', '10:00', '10:50')];
  const b = [S('B', '1', 'Tue', '10:00', '10:50')];
  // A latest-end pref neither violates → equal scores → original order preserved.
  const ranked = rankSchedules([a, b], { latestEnd: '17:00' });
  assert.deepEqual(order(ranked), [a, b]);
});

test('scoreSchedule breakdown: early-start penalty is per-hour, per-meeting', () => {
  const cand = [S('A', '1', 'Mon Wed', '09:00', '09:50')]; // two meetings, each 1h before 10:00
  const { score, breakdown } = scoreSchedule(cand, { earliestStart: '10:00' });
  assert.equal(breakdown.earlyStart, WEIGHTS.earlyStartPerHour * 2); // 2 meetings × 1h
  assert.equal(score, WEIGHTS.earlyStartPerHour * 2);
});
