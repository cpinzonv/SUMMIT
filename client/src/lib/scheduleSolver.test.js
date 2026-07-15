import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSchedules,
  sectionsConflict,
  isSchedulable,
  meetingBlocks,
} from './scheduleSolver.js';

// Compact section factory. days is a space/─separated token string for brevity.
let seq = 0;
const S = (courseCode, sectionNumber, days, startTime, endTime, extra = {}) => ({
  id: extra.id || `${courseCode}-${sectionNumber}-${seq++}`,
  courseCode,
  sectionNumber,
  days: days ? days.split(/\s+/) : [],
  startTime,
  endTime,
  ...extra,
});
const codesOf = (schedule) => schedule.map((s) => `${s.courseCode}§${s.sectionNumber}`).sort();

/* ----------------------------------------------------------- overlap detection */

test('same-day overlapping times conflict', () => {
  const a = S('MATH 162', '001', 'Mon Wed Fri', '10:00', '10:50');
  const b = S('CHEM 101', 'A', 'Mon', '10:30', '11:20');
  assert.equal(sectionsConflict(a, b), true);
});

test('same-day back-to-back (adjacent) is NOT a conflict', () => {
  const a = S('MATH 162', '001', 'Mon', '10:00', '10:50');
  const b = S('CHEM 101', 'A', 'Mon', '10:50', '11:40'); // starts exactly when a ends
  assert.equal(sectionsConflict(a, b), false);
});

test('same clock time on different days is NOT a conflict', () => {
  const a = S('MATH 162', '001', 'Mon Wed', '10:00', '10:50');
  const b = S('CHEM 101', 'A', 'Tue Thu', '10:00', '10:50');
  assert.equal(sectionsConflict(a, b), false);
});

test('overlap only counts on a shared day', () => {
  const a = S('A', '1', 'Mon Wed Fri', '09:00', '09:50');
  const b = S('B', '1', 'Wed', '09:30', '10:20'); // clashes on Wed only → conflict
  assert.equal(sectionsConflict(a, b), true);
  const c = S('C', '1', 'Tue Thu', '09:30', '10:20'); // no shared day → fine
  assert.equal(sectionsConflict(a, c), false);
});

/* ------------------------------------------------------- schedulability / blocks */

test('isSchedulable requires a day and a valid [start,end)', () => {
  assert.equal(isSchedulable(S('A', '1', 'Mon', '10:00', '10:50')), true);
  assert.equal(isSchedulable(S('A', '1', '', '10:00', '10:50')), false); // no days
  assert.equal(isSchedulable(S('A', '1', 'Mon', '10:00', null)), false); // no end
  assert.equal(isSchedulable(S('A', '1', 'Mon', '10:50', '10:00')), false); // end<=start
});

test('meetingBlocks maps tokens to minute intervals', () => {
  assert.deepEqual(meetingBlocks(S('A', '1', 'Mon Fri', '10:00', '10:50')), [
    { dayIdx: 1, start: 600, end: 650 },
    { dayIdx: 5, start: 600, end: 650 },
  ]);
});

/* --------------------------------------------------------- required vs optional */

test('required courses each contribute exactly one section', () => {
  const courses = [
    { code: 'MATH 162', required: true, sections: [S('MATH 162', '001', 'Mon Wed', '10:00', '10:50')] },
    { code: 'CHEM 101', required: true, sections: [S('CHEM 101', 'A', 'Tue Thu', '13:00', '14:15')] },
  ];
  const r = generateSchedules(courses);
  assert.equal(r.count, 1);
  assert.deepEqual(codesOf(r.schedules[0]), ['CHEM 101§A', 'MATH 162§001']);
});

test('an optional course is included when it fits and skipped when it clashes', () => {
  // Required MATH on Mon 10-10:50. Optional GYM offered twice: one clashes, one fits.
  const courses = [
    { code: 'MATH 162', required: true, sections: [S('MATH 162', '001', 'Mon', '10:00', '10:50')] },
    {
      code: 'GYM',
      required: false,
      sections: [
        S('GYM', 'X', 'Mon', '10:00', '10:50'), // clashes with MATH
        S('GYM', 'Y', 'Fri', '10:00', '10:50'), // fits
      ],
    },
  ];
  const r = generateSchedules(courses);
  const shapes = r.schedules.map(codesOf).sort();
  // Valid: {MATH+GYM Y}, {MATH alone}. GYM X never combines with the required MATH.
  assert.deepEqual(shapes, [['MATH 162§001'], ['GYM§Y', 'MATH 162§001']].sort());
});

test('an all-optional input never returns the empty (zero-class) schedule', () => {
  const courses = [
    { code: 'A', required: false, sections: [S('A', '1', 'Mon', '10:00', '10:50')] },
    { code: 'B', required: false, sections: [S('B', '1', 'Mon', '10:00', '10:50')] }, // clashes with A
  ];
  const r = generateSchedules(courses);
  const shapes = r.schedules.map(codesOf).sort();
  assert.deepEqual(shapes, [['A§1'], ['B§1']]); // {}, i.e. skip-both, is excluded
});

/* ----------------------------------------------------------- zero-valid schedules */

test('two required courses that always clash yields zero schedules with conflict pairs', () => {
  const courses = [
    { code: 'MATH 162', required: true, sections: [S('MATH 162', '001', 'Mon Wed', '10:00', '10:50')] },
    { code: 'CHEM 101', required: true, sections: [S('CHEM 101', 'A', 'Mon', '10:30', '11:20')] },
  ];
  const r = generateSchedules(courses);
  assert.equal(r.count, 0);
  assert.equal(r.reason.type, 'conflicts');
  assert.equal(r.conflictPairs.length, 1);
  assert.deepEqual(codesOf(r.conflictPairs[0]), ['CHEM 101§A', 'MATH 162§001']);
});

test('a required course with no schedulable section reports required-empty', () => {
  const courses = [
    { code: 'MATH 162', required: true, sections: [S('MATH 162', '001', 'Mon', '10:00', '10:50')] },
    { code: 'LAB', required: true, sections: [S('LAB', '1', 'Mon', null, null)] }, // no times
  ];
  const r = generateSchedules(courses);
  assert.equal(r.count, 0);
  assert.equal(r.reason.type, 'required-empty');
  assert.deepEqual(r.reason.courses, ['LAB']);
});

/* -------------------------------------------------------------- unschedulable flag */

test('unschedulable sections are excluded from math but reported, not dropped', () => {
  const courses = [
    {
      code: 'MATH 162',
      required: true,
      sections: [
        S('MATH 162', '001', 'Mon', '10:00', '10:50'),
        S('MATH 162', '003', '', null, null), // no days/times → unschedulable
      ],
    },
  ];
  const r = generateSchedules(courses);
  assert.equal(r.count, 1); // only §001 is used
  assert.deepEqual(codesOf(r.schedules[0]), ['MATH 162§001']);
  assert.equal(r.unschedulable.length, 1);
  assert.equal(r.unschedulable[0].courseCode, 'MATH 162');
  assert.equal(r.unschedulable[0].sectionNumber, '003');
});

/* --------------------------------------------------------------------- pin filtering */

test('pinning a section restricts that course to only the pinned section', () => {
  const courses = [
    {
      code: 'MATH 162',
      required: true,
      sections: [
        S('MATH 162', '001', 'Mon', '10:00', '10:50'),
        S('MATH 162', '002', 'Tue', '10:00', '10:50', { pinned: true }),
      ],
    },
    { code: 'CHEM 101', required: true, sections: [S('CHEM 101', 'A', 'Fri', '13:00', '14:15')] },
  ];
  const r = generateSchedules(courses);
  assert.equal(r.count, 1); // §001 is filtered out by the pin
  assert.deepEqual(codesOf(r.schedules[0]), ['CHEM 101§A', 'MATH 162§002']);
});

test('pins across courses combine (AND)', () => {
  const courses = [
    {
      code: 'MATH 162',
      required: true,
      sections: [
        S('MATH 162', '001', 'Mon', '09:00', '09:50', { pinned: true }),
        S('MATH 162', '002', 'Mon', '11:00', '11:50'),
      ],
    },
    {
      code: 'CHEM 101',
      required: true,
      sections: [
        S('CHEM 101', 'A', 'Tue', '09:00', '09:50', { pinned: true }),
        S('CHEM 101', 'B', 'Wed', '09:00', '09:50'),
      ],
    },
  ];
  const r = generateSchedules(courses);
  assert.equal(r.count, 1);
  assert.deepEqual(codesOf(r.schedules[0]), ['CHEM 101§A', 'MATH 162§001']);
});

test('a pin that clashes with every section of another required course names the blocker', () => {
  const courses = [
    {
      code: 'MATH 162',
      required: true,
      sections: [S('MATH 162', '002', 'Mon Wed', '10:00', '11:15', { pinned: true })],
    },
    {
      code: 'CHEM 101',
      required: true,
      sections: [
        S('CHEM 101', 'A', 'Mon', '10:30', '11:20'),
        S('CHEM 101', 'B', 'Wed', '10:00', '10:50'),
      ],
    },
  ];
  const r = generateSchedules(courses);
  assert.equal(r.count, 0);
  assert.equal(r.reason.type, 'pin-conflict');
  assert.equal(r.reason.pinnedCourse, 'MATH 162');
  assert.equal(r.reason.blockedCourse, 'CHEM 101');
});

/* ------------------------------------------------------------------ scale guard */

test('scale guard prunes the largest optional courses past the cap', () => {
  // 3 required × 3 sections = 27 required combos. Add a fat optional (10 sections)
  // → 27 × 11 = 297 > cap(50). The optional gets pruned; required combos remain.
  const req = (code) => ({
    code,
    required: true,
    sections: [0, 1, 2].map((i) => S(code, `s${i}`, 'Mon', `${8 + i}:00`, `${8 + i}:50`)),
  });
  const optSections = Array.from({ length: 10 }, (_, i) => S('OPT', `o${i}`, 'Sat', `${8 + i}:00`, `${8 + i}:50`));
  const courses = [req('AAA'), req('BBB'), req('CCC'), { code: 'OPT', required: false, sections: optSections }];
  const r = generateSchedules(courses, { maxCombinations: 50 });
  assert.deepEqual(r.prunedOptional, ['OPT']); // the fat optional is pruned, not the required trio
  // The three required courses share the same three Mon hours, so a valid pick
  // assigns a distinct hour to each course → 3! = 6 conflict-free combinations.
  assert.equal(r.count, 6);
  assert.ok(r.schedules.every((s) => s.every((sec) => sec.courseCode !== 'OPT')));
});

test('scale guard leaves small inputs untouched', () => {
  const courses = [
    { code: 'A', required: true, sections: [S('A', '1', 'Mon', '09:00', '09:50'), S('A', '2', 'Tue', '09:00', '09:50')] },
    { code: 'B', required: false, sections: [S('B', '1', 'Fri', '09:00', '09:50')] },
  ];
  const r = generateSchedules(courses);
  assert.deepEqual(r.prunedOptional, []);
  assert.equal(r.truncated, false);
});

/* -------------------------------------------------------------- deterministic order */

test('output order is stable and independent of input course/section order', () => {
  const build = (order) => {
    const math = {
      code: 'MATH 162',
      required: true,
      sections: [S('MATH 162', '002', 'Tue', '10:00', '10:50', { id: 'm2' }), S('MATH 162', '001', 'Mon', '10:00', '10:50', { id: 'm1' })],
    };
    const chem = { code: 'CHEM 101', required: true, sections: [S('CHEM 101', 'A', 'Fri', '13:00', '14:15', { id: 'c1' })] };
    return order === 'ab' ? [math, chem] : [chem, math];
  };
  const r1 = generateSchedules(build('ab'));
  const r2 = generateSchedules(build('ba'));
  const shape = (r) => r.schedules.map((s) => s.map((x) => x.id));
  // CHEM sorts before MATH; MATH §001 before §002 → identical, stable ordering.
  assert.deepEqual(shape(r1), shape(r2));
  assert.deepEqual(shape(r1), [
    ['c1', 'm1'],
    ['c1', 'm2'],
  ]);
});
