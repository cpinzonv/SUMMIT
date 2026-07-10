import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodKeyFor, limitFor, TIER_LIMITS } from '../src/config/tiers.js';

test('periodKeyFor — lifetime is constant', () => {
  assert.equal(periodKeyFor('lifetime', new Date(2026, 0, 1)), 'lifetime');
  assert.equal(periodKeyFor('lifetime', new Date(2030, 5, 9)), 'lifetime');
});

test('periodKeyFor — monthly is YYYY-MM', () => {
  assert.equal(periodKeyFor('month', new Date(2026, 0, 15)), '2026-01');
  assert.equal(periodKeyFor('month', new Date(2026, 11, 31)), '2026-12');
});

test('periodKeyFor — semester S1=Jan–Jun, S2=Jul–Dec', () => {
  assert.equal(periodKeyFor('semester', new Date(2026, 0, 1)), '2026-S1'); // Jan
  assert.equal(periodKeyFor('semester', new Date(2026, 5, 30)), '2026-S1'); // Jun 30
  assert.equal(periodKeyFor('semester', new Date(2026, 6, 1)), '2026-S2'); // Jul 1
  assert.equal(periodKeyFor('semester', new Date(2026, 11, 31)), '2026-S2'); // Dec 31
});

test('limit math — FREE caps', () => {
  assert.deepEqual(limitFor('free', 'extraction'), { limit: 2, period: 'semester' });
  assert.deepEqual(limitFor('free', 'ai_cards'), { limit: 50, period: 'lifetime' });
  assert.equal(limitFor('free', 'transcription_minutes').limit, 180);
  assert.equal(limitFor('free', 'transcription_minutes').maxPerRecording, 90);
  assert.equal(limitFor('free', 'podcasts').limit, 1);
  assert.equal(limitFor('free', 'podcasts').premiumVoice, false);
});

test('limit math — PRO unlimited extraction/cards, metered transcription/podcasts', () => {
  assert.equal(limitFor('pro', 'extraction').limit, null);
  assert.equal(limitFor('pro', 'ai_cards').limit, null);
  assert.deepEqual(limitFor('pro', 'transcription_minutes'), { limit: 480, period: 'month' });
  assert.equal(limitFor('pro', 'podcasts').limit, 3);
  assert.equal(limitFor('pro', 'podcasts').period, 'month');
  assert.equal(limitFor('pro', 'podcasts').premiumVoice, false);
});

test('limit math — MAX higher caps + premium voices', () => {
  assert.equal(limitFor('max', 'transcription_minutes').limit, 1800);
  assert.equal(limitFor('max', 'podcasts').limit, 10);
  assert.equal(limitFor('max', 'podcasts').premiumVoice, true);
});

test('lms_sync gating by tier', () => {
  assert.equal(TIER_LIMITS.free.lms_sync, false);
  assert.equal(TIER_LIMITS.pro.lms_sync, true);
  assert.equal(TIER_LIMITS.max.lms_sync, true);
});
