import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRequirementProgress, normCode } from './requirementProgress.js';

const cat = (name, creditsRequired, courses = []) => ({ name, creditsRequired, courses });
const rc = (courseCode, credits = null) => ({ courseCode, credits });
const item = (code, credits, extra = {}) => ({ code, credits, name: extra.name ?? code, term: extra.term ?? 'Fall 2026' });

test('normCode is case- and whitespace-insensitive', () => {
  assert.equal(normCode('math 162'), 'MATH162');
  assert.equal(normCode('  MATH162 '), 'MATH162');
  assert.equal(normCode('MaTh  162'), 'MATH162');
  assert.equal(normCode(null), '');
});

test('a planned course matches its category by normalized code', () => {
  const categories = [cat('Core', 8, [rc('MATH 162', 4), rc('CS 101', 4)])];
  const plan = [item('math162', 4), item('cs 101', 4)];
  const r = computeRequirementProgress(plan, categories);
  assert.equal(r.categories[0].satisfiedCredits, 8);
  assert.deepEqual(r.notMatched, []);
  assert.equal(r.overallPlannedCredits, 8);
});

test('a course in two categories counts toward only the FIRST (no double count)', () => {
  const categories = [
    cat('Core', 4, [rc('MATH 162', 4)]),
    cat('Math elective', 4, [rc('MATH 162', 4)]), // same course listed again
  ];
  const plan = [item('MATH 162', 4)];
  const r = computeRequirementProgress(plan, categories);
  assert.equal(r.categories[0].satisfiedCredits, 4);
  assert.equal(r.categories[1].satisfiedCredits, 0);
  assert.equal(r.satisfiedTotal, 4); // counted once
});

test('unmatched planned courses go to notMatched but still count toward the overall total', () => {
  const categories = [cat('Core', 4, [rc('CS 101', 4)])];
  const plan = [item('CS 101', 4), item('PHIL 200', 3)];
  const r = computeRequirementProgress(plan, categories);
  assert.equal(r.categories[0].satisfiedCredits, 4);
  assert.equal(r.overallPlannedCredits, 7);
  assert.equal(r.notMatched.length, 1);
  assert.equal(r.notMatched[0].code, 'PHIL 200');
});

test('a rule-only category (no course list) cannot auto-match — the course is notMatched', () => {
  const categories = [cat('Humanities', 9, [])]; // "9 credits from any 300-level HIST", no explicit courses
  const plan = [item('HIST 310', 3)];
  const r = computeRequirementProgress(plan, categories);
  assert.equal(r.categories[0].satisfiedCredits, 0);
  assert.equal(r.notMatched.length, 1);
  assert.equal(r.notMatched[0].code, 'HIST 310');
});

test('a matched course with no credits counts as matched but adds 0 credits', () => {
  const categories = [cat('Core', 4, [rc('CS 101')])];
  const plan = [item('CS 101', null)];
  const r = computeRequirementProgress(plan, categories);
  assert.equal(r.categories[0].satisfiedCredits, 0);
  assert.deepEqual(r.categories[0].matchedCodes, ['CS 101']);
  assert.deepEqual(r.notMatched, []); // matched, not orphaned
});

test('a codeless planned course lands in notMatched and still adds to the overall total', () => {
  const categories = [cat('Core', 4, [rc('CS 101', 4)])];
  const plan = [{ code: null, credits: 3, name: 'Study abroad seminar', term: 'Spring 2027' }];
  const r = computeRequirementProgress(plan, categories);
  assert.equal(r.overallPlannedCredits, 3);
  assert.equal(r.notMatched.length, 1);
  assert.equal(r.notMatched[0].name, 'Study abroad seminar');
});

test('requiredTotal sums category requirements; empty inputs are safe', () => {
  const categories = [cat('Core', 30, []), cat('Math', 16, [])];
  assert.equal(computeRequirementProgress([], categories).requiredTotal, 46);
  const empty = computeRequirementProgress([], []);
  assert.deepEqual(empty, { categories: [], overallPlannedCredits: 0, satisfiedTotal: 0, requiredTotal: 0, notMatched: [] });
});
