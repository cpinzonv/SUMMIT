import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPlace, canMove, semesterOrder, isCourseToken } from './placement.js';

const course = (code, prereqGroups = [], offeredTerms = null) => ({ code, prereqGroups, offeredTerms });
const placed = (code, season, year, prereqGroups = [], offeredTerms = null) => ({ code, season, year, prereqGroups, offeredTerms });
const set = (...codes) => new Set(codes);
const S27 = { season: 'Spring', year: 2027 };
const F26 = { season: 'Fall', year: 2026 };

/* ------------------------------------------------------------------- helpers */

test('semesterOrder is chronological across years and seasons', () => {
  assert.ok(semesterOrder('Fall', 2026) < semesterOrder('Spring', 2027));
  assert.ok(semesterOrder('Spring', 2027) < semesterOrder('Summer', 2027));
  assert.ok(semesterOrder('Summer', 2027) < semesterOrder('Fall', 2027));
});

test('isCourseToken: course codes have a number, tokens like PLACEMENT do not', () => {
  assert.equal(isCourseToken('MATH 161'), true);
  assert.equal(isCourseToken('PLACEMENT'), false);
  assert.equal(isCourseToken('instructor permission'), false);
});

/* ---------------------------------------------------------- prereqs (OR-group) */

test('an OR-group is satisfied by EITHER member', () => {
  const c = course('MATH 162', [['MATH 161', 'PLACEMENT']]);
  assert.equal(canPlace(c, S27, [placed('MATH 161', 'Fall', 2026)], set()).ok, true); // via the course
  assert.equal(canPlace(c, S27, [], set('PLACEMENT')).ok, true); // via the met token
  assert.equal(canPlace(c, S27, [], set()).ok, false); // neither → blocked
});

test('a completed course satisfies a prereq regardless of semester order', () => {
  const c = course('MATH 162', [['MATH 161']]);
  assert.equal(canPlace(c, F26, [], set('MATH 161')).ok, true);
});

test('a course placed in a strictly EARLIER semester satisfies the prereq', () => {
  const c = course('MATH 162', [['MATH 161']]);
  assert.equal(canPlace(c, S27, [placed('MATH 161', 'Fall', 2026)], set()).ok, true);
});

test('same-semester does NOT satisfy a prereq (no co-requisites this stage)', () => {
  const c = course('MATH 162', [['MATH 161']]);
  const r = canPlace(c, S27, [placed('MATH 161', 'Spring', 2027)], set());
  assert.equal(r.ok, false);
  assert.equal(r.reasons[0].type, 'prereq');
  assert.match(r.reasons[0].message, /MATH 161/);
});

test('matching is normalized (case/whitespace-insensitive)', () => {
  const c = course('MATH 162', [['math161']]);
  assert.equal(canPlace(c, S27, [placed('MATH 161', 'Fall', 2026)], set()).ok, true);
  assert.equal(canPlace(c, F26, [], set('MATH 161')).ok, true);
});

test('a chain fails at the RIGHT link (161 needs 118, not 162)', () => {
  // 162 with 161 placed earlier is fine…
  const c162 = course('MATH 162', [['MATH 161']]);
  assert.equal(canPlace(c162, S27, [placed('MATH 161', 'Fall', 2026)], set()).ok, true);
  // …but 161 itself, needing 118 which is nowhere, fails on 118.
  const c161 = course('MATH 161', [['MATH 118']]);
  const r = canPlace(c161, F26, [], set());
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons[0].group, ['MATH 118']);
});

/* --------------------------------------------------------------- offerings */

test('unknown offered_terms (null) never blocks', () => {
  assert.equal(canPlace(course('CSCI 310', [], null), S27, [], set()).ok, true);
  assert.equal(canPlace(course('CSCI 310', [], []), S27, [], set()).ok, true); // empty = unknown too
});

test('a course known-not-offered in the target term is blocked', () => {
  const r = canPlace(course('CSCI 310', [], ['Fall']), S27, [], set());
  assert.equal(r.ok, false);
  assert.equal(r.reasons[0].type, 'offering');
  assert.match(r.reasons[0].message, /Spring/);
});

test('offered in the target term is allowed', () => {
  assert.equal(canPlace(course('CSCI 310', [], ['Fall', 'Spring']), S27, [], set()).ok, true);
});

/* --------------------------------------------------- multiple reasons together */

test('a prereq miss AND an offerings miss are reported together', () => {
  const c = course('MATH 162', [['MATH 161']], ['Fall']); // needs 161, not offered in Spring
  const r = canPlace(c, S27, [], set());
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 2);
  assert.deepEqual(r.reasons.map((x) => x.type).sort(), ['offering', 'prereq']);
});

/* ------------------------------------------------------- downstream (canMove) */

test('moving a prereq LATER strands the dependent (downstream block)', () => {
  const plan = [
    placed('MATH 161', 'Fall', 2026, [['MATH 118']]),
    placed('MATH 162', 'Spring', 2027, [['MATH 161']]),
  ];
  // 118 is completed so MATH 161 itself stays valid — isolate the downstream effect.
  const completed = set('MATH 118');
  const moved = course('MATH 161', [['MATH 118']]);
  const r = canMove(moved, { season: 'Fall', year: 2027 }, plan, completed); // later than 162
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.type === 'downstream' && /MATH 162/.test(x.message)));
});

test('moving a prereq to a still-earlier semester is allowed (no strand)', () => {
  const plan = [
    placed('MATH 161', 'Fall', 2026, [['MATH 118']]),
    placed('MATH 162', 'Spring', 2027, [['MATH 161']]),
  ];
  const completed = set('MATH 118');
  const r = canMove(course('MATH 161', [['MATH 118']]), { season: 'Summer', year: 2026 }, plan, completed);
  assert.equal(r.ok, true);
});

test('moving a course before its own prereq blocks on the moved course itself', () => {
  const plan = [
    placed('MATH 161', 'Spring', 2027, [['MATH 118']]),
    placed('MATH 162', 'Fall', 2027, [['MATH 161']]),
  ];
  const completed = set('MATH 118');
  // Move 162 to Fall 2026 — now 161 (Spring 2027) is no longer earlier.
  const r = canMove(course('MATH 162', [['MATH 161']]), { season: 'Fall', year: 2026 }, plan, completed);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.type === 'prereq'));
});
