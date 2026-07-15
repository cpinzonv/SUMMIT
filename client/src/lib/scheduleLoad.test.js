import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLoads, effectiveDate, roundHalf, hoursLabel } from './scheduleLoad.js';

// Build a local-midnight ISO for a given Y/M/D (month 1-based), matching how the
// app stores planned/due dates. Round-trips to the same calendar day in any TZ.
const iso = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const key = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const card = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  contextId: 'class-1',
  boardStage: 'not_started',
  done: false,
  estimatedHours: 2,
  dueDate: iso(2026, 7, 15),
  plannedDate: null,
  scheduledTime: null,
  ...over,
});

test('roundHalf / hoursLabel', () => {
  assert.equal(roundHalf(2.24), 2);
  assert.equal(roundHalf(2.25), 2.5);
  assert.equal(hoursLabel(5), '5h');
  assert.equal(hoursLabel(2.5), '2.5h');
});

test('effectiveDate precedence: scheduled > planned > due', () => {
  assert.equal(effectiveDate({ dueDate: iso(2026, 7, 10) }).getDate(), 10);
  assert.equal(effectiveDate({ dueDate: iso(2026, 7, 10), plannedDate: iso(2026, 7, 12) }).getDate(), 12);
  assert.equal(
    effectiveDate({ dueDate: iso(2026, 7, 10), plannedDate: iso(2026, 7, 12), scheduledTime: iso(2026, 7, 14, 9) }).getDate(),
    14,
  );
  assert.equal(effectiveDate({}), null);
});

test('sums estimated hours per effective day, rounded to halves', () => {
  const loads = dayLoads([
    card({ estimatedHours: 2, dueDate: iso(2026, 7, 15) }),
    card({ estimatedHours: 1.25, dueDate: iso(2026, 7, 15) }),
    card({ estimatedHours: 3, plannedDate: iso(2026, 7, 16), dueDate: iso(2026, 7, 15) }),
  ]);
  assert.equal(loads.get(key(2026, 7, 15)).hours, 3.5); // 2 + 1.25 → 3.25 → 3.5
  assert.equal(loads.get(key(2026, 7, 16)).hours, 3); // planned_date wins
});

test('excludes done, un-estimated, and inactive-class cards', () => {
  const loads = dayLoads(
    [
      card({ estimatedHours: 2 }), // counts
      card({ estimatedHours: 4, done: true }), // done → excluded
      card({ estimatedHours: 4, boardStage: 'done' }), // done stage → excluded
      card({ estimatedHours: null }), // no estimate → excluded
      card({ estimatedHours: 5, contextId: 'archived-class' }), // inactive → excluded
    ],
    { activeClassIds: new Set(['class-1']) },
  );
  assert.equal(loads.get(key(2026, 7, 15)).hours, 2);
  assert.equal(loads.get(key(2026, 7, 15)).items.length, 1);
});

test('items are sorted by estimated hours descending', () => {
  const loads = dayLoads([
    card({ estimatedHours: 1, title: 'small' }),
    card({ estimatedHours: 4, title: 'big' }),
    card({ estimatedHours: 2, title: 'mid' }),
  ]);
  assert.deepEqual(loads.get(key(2026, 7, 15)).items.map((c) => c.title), ['big', 'mid', 'small']);
});
