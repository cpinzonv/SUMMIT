// Force a negative-offset zone (America/Panama = UTC-5, no DST) so the
// off-by-one this fixes is real here. Must be set before any Date is created.
process.env.TZ = 'America/Panama';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateOnlyToInput, inputToDateOnly } from './dateOnly.js';

// The API serializes a Postgres DATE column as a UTC-midnight ISO string.
const API_AUG_25 = '2026-08-25T00:00:00.000Z';

test('precondition: naive Date parsing really shifts a day back in UTC-5', () => {
  // This is exactly the old bug — proves the timezone is in effect for this run.
  assert.equal(new Date(API_AUG_25).getDate(), 24);
});

test('dateOnlyToInput keeps the stored calendar date (no UTC shift)', () => {
  assert.equal(dateOnlyToInput(API_AUG_25), '2026-08-25');
});

test('dateOnlyToInput accepts a bare YYYY-MM-DD unchanged', () => {
  assert.equal(dateOnlyToInput('2026-08-25'), '2026-08-25');
});

test('dateOnlyToInput handles empty / nullish', () => {
  assert.equal(dateOnlyToInput(''), '');
  assert.equal(dateOnlyToInput(null), '');
  assert.equal(dateOnlyToInput(undefined), '');
});

test('inputToDateOnly persists the bare calendar date (no UTC shift on write)', () => {
  assert.equal(inputToDateOnly('2026-08-25'), '2026-08-25');
  assert.equal(inputToDateOnly(''), null);
  assert.equal(inputToDateOnly(null), null);
});

test('round-trips the exact calendar date through the edit modal in UTC-5', () => {
  const shown = dateOnlyToInput(API_AUG_25); // what <input type="date"> displays
  assert.equal(shown, '2026-08-25');
  const saved = inputToDateOnly(shown); // what we send back to persist
  assert.equal(saved, '2026-08-25'); // same day the user saw — no drift
});

test('is timezone-agnostic across year boundaries (UTC-anchored API value)', () => {
  assert.equal(dateOnlyToInput('2026-01-01T00:00:00.000Z'), '2026-01-01');
  assert.equal(dateOnlyToInput('2026-12-31T00:00:00.000Z'), '2026-12-31');
});
