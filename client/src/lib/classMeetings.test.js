import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedMeetings, generateClassSessions, dayIndex, toMinutes } from './classMeetings.js';

test('dayIndex accepts Mon..Sun, MON, and full names', () => {
  assert.equal(dayIndex('Mon'), 1);
  assert.equal(dayIndex('MON'), 1);
  assert.equal(dayIndex('friday'), 5);
  assert.equal(dayIndex('Sun'), 0);
  assert.equal(dayIndex('nope'), -1);
});

test('toMinutes parses 24h and am/pm', () => {
  assert.equal(toMinutes('10:00'), 600);
  assert.equal(toMinutes('9:30 am'), 570);
  assert.equal(toMinutes('1:00 pm'), 780);
  assert.equal(toMinutes(''), null);
});

test('normalizedMeetings prefers rich meetingTimes', () => {
  const cls = { syllabus: { meetingTimes: [{ day: 'Mon', start: '10:00', end: '10:50', location: 'Bldg 4' }] } };
  assert.deepEqual(normalizedMeetings(cls), [{ day: 'Mon', start: '10:00', end: '10:50', location: 'Bldg 4' }]);
});

test('normalizedMeetings falls back to legacy flat fields', () => {
  const cls = { meetingDays: ['Tue', 'Thu'], meetingTime: '14:00', syllabus: { location: 'Hall A' } };
  assert.deepEqual(normalizedMeetings(cls), [
    { day: 'Tue', start: '14:00', end: null, location: 'Hall A' },
    { day: 'Thu', start: '14:00', end: null, location: 'Hall A' },
  ]);
});

test('normalizedMeetings returns [] with no schedule', () => {
  assert.deepEqual(normalizedMeetings({}), []);
  assert.deepEqual(normalizedMeetings(null), []);
});

// The headline rendering test: a MWF 10:00–10:50 class across a fixed span
// generates a session on every Mon/Wed/Fri in range, on the correct dates.
test('generateClassSessions — MWF 10:00–10:50 over two weeks → 6 sessions on the right dates', () => {
  const cls = {
    id: 'c1',
    startDate: '2026-08-24', // Monday
    endDate: '2026-09-04',   // Friday (end of 2nd week)
    syllabus: {
      meetingTimes: [
        { day: 'Mon', start: '10:00', end: '10:50' },
        { day: 'Wed', start: '10:00', end: '10:50' },
        { day: 'Fri', start: '10:00', end: '10:50' },
      ],
    },
  };
  const sessions = generateClassSessions(cls);
  const dates = sessions.map((s) => s.date);
  assert.deepEqual(dates, [
    '2026-08-24', '2026-08-26', '2026-08-28', // week 1: Mon Wed Fri
    '2026-08-31', '2026-09-02', '2026-09-04', // week 2: Mon Wed Fri
  ]);
  assert.equal(sessions.length, 6);
  for (const s of sessions) {
    assert.equal(s.start, '10:00');
    assert.equal(s.end, '10:50');
    assert.equal(s.startMin, 600);
    assert.equal(s.endMin, 650);
  }
});

test('generateClassSessions — clamps to the caller window', () => {
  const cls = {
    startDate: '2026-08-24',
    endDate: '2026-12-11',
    syllabus: { meetingTimes: [{ day: 'Mon', start: '10:00', end: '10:50' }] },
  };
  // Only the last week of August is visible.
  const sessions = generateClassSessions(cls, { from: '2026-08-24', to: '2026-08-30' });
  assert.deepEqual(sessions.map((s) => s.date), ['2026-08-24']);
});

test('generateClassSessions — no schedule or no bounds → []', () => {
  assert.deepEqual(generateClassSessions({ startDate: '2026-08-24', endDate: '2026-09-04' }), []);
  // meetings but no dates and no window → cannot bound the recurrence
  assert.deepEqual(generateClassSessions({ syllabus: { meetingTimes: [{ day: 'Mon', start: '10:00' }] } }), []);
});
