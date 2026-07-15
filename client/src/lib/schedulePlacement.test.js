import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestPlacements, DAY_WINDOW_START, DAY_WINDOW_END } from './schedulePlacement.js';

const at = (h, m = 0) => h * 60 + m;
const item = (id, durationMin) => ({ id, durationMin });
const byId = (placements) => Object.fromEntries(placements.map((p) => [p.id, p.startMin]));

test('empty day: items packed from the window start, longest first', () => {
  const { placements, unplaceable } = suggestPlacements([item('a', 60), item('b', 120)], []);
  const pos = byId(placements);
  assert.equal(pos.b, DAY_WINDOW_START); // 08:00 — longest first
  assert.equal(pos.a, DAY_WINDOW_START + 120); // right after b
  assert.deepEqual(unplaceable, []);
  // returned in start order
  assert.deepEqual(placements.map((p) => p.id), ['b', 'a']);
});

test('places into open gaps only — no overlap with a class', () => {
  const cls = { startMin: at(10), endMin: at(10, 50), isClass: true };
  const { placements } = suggestPlacements([item('a', 60)], [cls]);
  // 08:00 gap fits the 60-min item before class.
  assert.equal(byId(placements).a, at(8));
});

test('leaves a 10-minute buffer after a class block', () => {
  // Fill 08:00–10:50 so the only room is right after class; the buffer pushes
  // the next start to 11:00 (10:50 + 10).
  const cls = { startMin: at(8), endMin: at(10, 50), isClass: true };
  const { placements } = suggestPlacements([item('a', 60)], [cls]);
  assert.equal(byId(placements).a, at(11)); // 10:50 + 10 buffer, snapped
});

test('no buffer after a non-class (assignment) block', () => {
  const block = { startMin: at(8), endMin: at(9), isClass: false };
  const { placements } = suggestPlacements([item('a', 60)], [block]);
  assert.equal(byId(placements).a, at(9)); // immediately after, no buffer
});

test('snaps start up to the next 15-minute mark', () => {
  // An assignment block ending at 10:40 → next start snaps to 10:45.
  const block = { startMin: at(8), endMin: at(10, 40), isClass: false };
  const { placements } = suggestPlacements([item('a', 30)], [block]);
  assert.equal(byId(placements).a, at(10, 45));
});

test('overflow: items that do not fit are reported unplaceable', () => {
  // Window is 14h (840 min). Three 5h items = 900 min → one cannot fit.
  const { placements, unplaceable } = suggestPlacements(
    [item('a', 300), item('b', 300), item('c', 300)],
    [],
  );
  assert.equal(placements.length, 2);
  assert.equal(unplaceable.length, 1);
});

test('a big item skips a too-small gap but a later small item can use it', () => {
  // Gap 1: 08:00–09:00 (60). Gap 2: 10:00–end (class 09:00–09:50 buffered to 10:00).
  const cls = { startMin: at(9), endMin: at(9, 50), isClass: true };
  const { placements, unplaceable } = suggestPlacements([item('big', 120), item('small', 45)], [cls]);
  const pos = byId(placements);
  assert.equal(pos.big, at(10)); // 120 can't fit the 60-min first gap → goes after class
  assert.equal(pos.small, at(8)); // 45 fits the first gap
  assert.deepEqual(unplaceable, []);
});

test('fully booked day: everything is unplaceable', () => {
  const wall = { startMin: DAY_WINDOW_START, endMin: DAY_WINDOW_END, isClass: false };
  const { placements, unplaceable } = suggestPlacements([item('a', 30), item('b', 60)], [wall]);
  assert.equal(placements.length, 0);
  assert.deepEqual(unplaceable.sort(), ['a', 'b']);
});

test('no items → empty result', () => {
  const { placements, unplaceable } = suggestPlacements([], [{ startMin: at(10), endMin: at(11), isClass: true }]);
  assert.deepEqual(placements, []);
  assert.deepEqual(unplaceable, []);
});

test('respects a custom working window', () => {
  const { placements } = suggestPlacements([item('a', 60)], [], { windowStart: at(9), windowEnd: at(12) });
  assert.equal(byId(placements).a, at(9));
});
