import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributePlan } from './distribute.js';
import { canPlace, semesterOrder } from './placement.js';
import { normCode } from './requirementProgress.js';

/* ---- builders -------------------------------------------------------------- */
const rc = (code, credits, prereqGroups = [], offeredTerms = null) => ({ code, credits, prereqGroups, offeredTerms });
function mkIndex(list) {
  const m = new Map();
  for (const c of list) m.set(normCode(c.code), { code: c.code, credits: c.credits, offeredTerms: c.offeredTerms ?? null, prereqGroups: c.prereqGroups ?? [], categoryId: c.categoryId ?? 'cat' });
  return m;
}
const cat = (id, creditsRequired, courses, satisfiedCredits = 0, name = id) => ({ id, name, creditsRequired, satisfiedCredits, courses });
const SEMS = (...ss) => ss.map((s) => { const [season, year] = s.split(' '); return { season, year: Number(year) }; });
const orderOf = (p) => semesterOrder(p.season, p.year);
const find = (placements, code) => placements.find((p) => normCode(p.code) === normCode(code));

/* ---- chain ordering -------------------------------------------------------- */
test('a prereq chain places in dependency order', () => {
  const courses = [rc('MATH 161', 4), rc('MATH 162', 4, [['MATH 161']]), rc('MATH 263', 4, [['MATH 162']])];
  const r = distributePlan({
    categories: [cat('math', 12, courses.map((c) => ({ courseCode: c.code, credits: c.credits })))],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Spring 2027', 'Fall 2027'),
  });
  assert.equal(r.placements.length, 3);
  assert.ok(orderOf(find(r.placements, 'MATH 161')) < orderOf(find(r.placements, 'MATH 162')));
  assert.ok(orderOf(find(r.placements, 'MATH 162')) < orderOf(find(r.placements, 'MATH 263')));
});

/* ---- summer-only ----------------------------------------------------------- */
test('a summer-only course lands in a summer term', () => {
  const courses = [rc('SUM 100', 4), rc('SUM 200', 4, [['SUM 100']], ['Summer'])];
  const r = distributePlan({
    categories: [cat('s', 8, courses.map((c) => ({ courseCode: c.code, credits: c.credits })))],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Summer 2027', 'Fall 2027'),
  });
  assert.equal(find(r.placements, 'SUM 200').season, 'Summer');
});

/* ---- credit caps ----------------------------------------------------------- */
test('no semester exceeds its credit max (summer uses the lower summer max)', () => {
  const courses = Array.from({ length: 6 }, (_, i) => rc(`X ${i}`, 4));
  const r = distributePlan({
    categories: [cat('x', 24, courses.map((c) => ({ courseCode: c.code, credits: c.credits })))],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Summer 2027', 'Fall 2027'),
    options: { target: 15, max: 18, summerMax: 8 },
  });
  const load = {};
  for (const p of r.placements) load[`${p.season} ${p.year}`] = (load[`${p.season} ${p.year}`] || 0) + p.credits;
  for (const [k, cr] of Object.entries(load)) assert.ok(cr <= (k.startsWith('Summer') ? 8 : 18), `${k}=${cr}`);
});

/* ---- even balancing -------------------------------------------------------- */
test('independent courses are balanced, not front-loaded to the target', () => {
  const courses = Array.from({ length: 4 }, (_, i) => rc(`IND ${i}`, 4));
  const r = distributePlan({
    categories: [cat('i', 16, courses.map((c) => ({ courseCode: c.code, credits: c.credits })))],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Spring 2027'),
    options: { target: 15, max: 18 },
  });
  const load = {};
  for (const p of r.placements) load[`${p.season} ${p.year}`] = (load[`${p.season} ${p.year}`] || 0) + p.credits;
  const loads = Object.values(load);
  assert.equal(loads.length, 2);
  assert.ok(Math.abs(loads[0] - loads[1]) <= 4, `balanced within one course: ${loads}`); // 8/8, not 12/4
});

/* ---- fixed courses untouched ---------------------------------------------- */
test('already-placed courses are never in the output and are honored as prereqs', () => {
  const courses = [rc('MATH 161', 4), rc('MATH 162', 4, [['MATH 161']])];
  const r = distributePlan({
    categories: [cat('m', 8, courses.map((c) => ({ courseCode: c.code, credits: c.credits })))],
    index: mkIndex(courses),
    semesters: SEMS('Spring 2027', 'Fall 2027'),
    plan: [{ code: 'MATH 161', season: 'Fall', year: 2026, credits: 4, prereqGroups: [] }], // fixed, earlier
  });
  assert.equal(find(r.placements, 'MATH 161'), undefined); // fixed → not re-placed
  assert.ok(find(r.placements, 'MATH 162')); // placed after the fixed prereq
});

/* ---- or-group satisfier preference ---------------------------------------- */
test('an OR-group already satisfied forces nothing; otherwise the cheapest member is chosen', () => {
  // satisfied by a completed course → C places, neither A nor B forced
  const courses = [rc('C 300', 4, [['A 100', 'B 100']]), rc('A 100', 4), rc('B 100', 4, [['Z 100']]), rc('Z 100', 4)];
  const sat = distributePlan({
    categories: [cat('c', 4, [{ courseCode: 'C 300', credits: 4 }])],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Spring 2027'),
    completed: new Set(['A 100']),
  });
  assert.ok(find(sat.placements, 'C 300'));
  assert.equal(find(sat.placements, 'A 100'), undefined);
  assert.equal(find(sat.placements, 'B 100'), undefined);

  // unsatisfied → choose A (0 own prereqs) over B (1 own prereq)
  const chosen = distributePlan({
    categories: [cat('c', 4, [{ courseCode: 'C 300', credits: 4 }])],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Spring 2027', 'Fall 2027'),
  });
  assert.ok(find(chosen.placements, 'A 100'));
  assert.equal(find(chosen.placements, 'B 100'), undefined);
});

/* ---- pick-N → tray --------------------------------------------------------- */
test('a category offering more than needed goes to the "You choose" tray, not auto-picked', () => {
  const courses = ['E1', 'E2', 'E3', 'E4'].map((c) => rc(c, 3));
  const r = distributePlan({
    categories: [cat('elec', 6, courses.map((c) => ({ courseCode: c.code, credits: c.credits })), 0, 'Electives')],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Spring 2027'),
  });
  assert.equal(r.placements.length, 0); // engine doesn't choose electives
  assert.equal(r.trayItems.length, 1);
  assert.equal(r.trayItems[0].remainingCredits, 6);
  assert.equal(r.trayItems[0].candidates.length, 4);
});

test('a rule-only category (no course rows) surfaces in the tray as needs-input', () => {
  const r = distributePlan({
    categories: [cat('hum', 9, [], 0, 'Humanities')],
    index: mkIndex([]),
    semesters: SEMS('Fall 2026'),
  });
  assert.equal(r.trayItems.length, 1);
  assert.equal(r.trayItems[0].ruleOnly, true);
  assert.equal(r.trayItems[0].remainingCredits, 9);
});

/* ---- prereq-of-placed auto-included --------------------------------------- */
test('a pick-N course that is a prereq of a placed course is force-included (and leaves the tray)', () => {
  const courses = ['E1', 'E2', 'E3', 'E4'].map((c) => rc(c, 3)).concat([rc('CS 400', 3, [['E2']])]);
  const r = distributePlan({
    categories: [cat('elec', 6, ['E1', 'E2', 'E3', 'E4'].map((c) => ({ courseCode: c, credits: 3 })), 0, 'Electives')],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Spring 2027', 'Fall 2027'),
    plan: [{ code: 'CS 400', season: 'Fall', year: 2027, credits: 3, prereqGroups: [['E2']] }],
  });
  assert.ok(find(r.placements, 'E2'), 'E2 is forced in as a prereq of placed CS 400');
  assert.ok(orderOf(find(r.placements, 'E2')) < semesterOrder('Fall', 2027)); // before its dependent
  assert.ok(!r.trayItems[0]?.candidates.some((c) => c.code === 'E2')); // removed from the tray
});

/* ---- cycle detection ------------------------------------------------------- */
test('a prereq cycle is detected and reported, not looped on', () => {
  const courses = [rc('M 210', 4, [['M 215']]), rc('M 215', 4, [['M 210']])];
  const r = distributePlan({
    categories: [cat('m', 8, courses.map((c) => ({ courseCode: c.code, credits: c.credits })))],
    index: mkIndex(courses),
    semesters: SEMS('Fall 2026', 'Spring 2027'),
  });
  assert.equal(r.placements.length, 0);
  assert.equal(r.unplaceable.length, 2);
  assert.ok(r.unplaceable.every((u) => /require each other/.test(u.reason)));
});

/* ---- impossible fit reported ---------------------------------------------- */
test('a course offered only in a term not in scope is reported unplaceable', () => {
  const courses = [rc('FALL 300', 4, [], ['Fall'])];
  const r = distributePlan({
    categories: [cat('f', 4, [{ courseCode: 'FALL 300', credits: 4 }])],
    index: mkIndex(courses),
    semesters: SEMS('Spring 2027', 'Spring 2028'), // no Fall in scope
  });
  assert.equal(r.placements.length, 0);
  assert.equal(r.unplaceable.length, 1);
  assert.match(r.unplaceable[0].reason, /Fall/);
});

/* ---- the invariant: every placement passes the same canPlace as manual drags */
test('every auto-fill placement satisfies canPlace against the run so far', () => {
  const courses = [rc('MATH 161', 4), rc('MATH 162', 4, [['MATH 161']]), rc('CS 101', 4), rc('CS 201', 4, [['CS 101']], ['Fall', 'Spring'])];
  const index = mkIndex(courses);
  const r = distributePlan({
    categories: [cat('all', 16, courses.map((c) => ({ courseCode: c.code, credits: c.credits })))],
    index,
    semesters: SEMS('Fall 2026', 'Spring 2027', 'Fall 2027', 'Spring 2028'),
  });
  // Replay each placement in order and assert canPlace holds — the same gate the UI uses.
  const done = new Set();
  const sorted = [...r.placements].sort((a, b) => orderOf(a) - orderOf(b));
  const built = [];
  for (const p of sorted) {
    const course = index.get(normCode(p.code));
    assert.equal(canPlace(course, { season: p.season, year: p.year }, built, done).ok, true, `${p.code} @ ${p.season} ${p.year}`);
    built.push({ code: p.code, season: p.season, year: p.year });
  }
});
