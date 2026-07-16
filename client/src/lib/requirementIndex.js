/**
 * Degree Requirements — Stage R2 client helpers. Pure glue between the roadmap's
 * planned courses (plan_items), the student's completed/transferred courses, and
 * the requirement sheet — producing the inputs the placement engine + progress
 * matcher consume. No React, no network.
 */
import { normCode } from './requirementProgress';

/** Map every requirement course by normalized code → its prereqs/offerings meta. */
export function buildRequirementIndex(categories = []) {
  const idx = new Map();
  for (const cat of categories) {
    for (const co of cat.courses || []) {
      const key = normCode(co.courseCode);
      if (key && !idx.has(key)) {
        idx.set(key, {
          code: co.courseCode,
          courseTitle: co.courseTitle ?? null,
          credits: co.credits ?? null,
          offeredTerms: co.offeredTerms ?? null,
          prereqGroups: co.prereqGroups || [],
          categoryId: cat.id,
        });
      }
    }
  }
  return idx;
}

/** A course's prereq/offering meta from the sheet, or a bare unconstrained course. */
export function resolveCourse(code, index) {
  return index.get(normCode(code)) || { code, offeredTerms: null, prereqGroups: [] };
}

/**
 * Everything the student "has" for prereq purposes, as normalized codes/tokens:
 * completed/transferred courses, planned courses already marked complete
 * (plan_items.status='completed'), and met non-course tokens.
 */
export function buildCompletedSet(planItems = [], completedCourses = [], metTokens = []) {
  const s = new Set();
  for (const it of planItems) if (it.status === 'completed' && it.code) s.add(normCode(it.code));
  for (const c of completedCourses) if (c.courseCode) s.add(normCode(c.courseCode));
  for (const m of metTokens) if (m.token) s.add(normCode(m.token));
  return s;
}

/** Placed (not-yet-completed) courses, resolved with prereqs/offerings for the engine. */
export function buildPlacements(planItems = [], index) {
  return planItems
    .filter((it) => it.status !== 'completed' && it.code)
    .map((it) => {
      const meta = resolveCourse(it.code, index);
      return { id: it.id, code: it.code, season: it.season, year: it.year, offeredTerms: meta.offeredTerms, prereqGroups: meta.prereqGroups };
    });
}

/**
 * The unified list of the student's courses for progress matching, deduped by
 * normalized code, each tagged `completed`. Combines planned courses with
 * completed/transferred ones (a completed record wins the "completed" flag).
 */
export function buildStudentCourses(planItems = [], completedCourses = []) {
  const completedCodes = new Set(completedCourses.map((c) => normCode(c.courseCode)).filter(Boolean));
  const byKey = new Map();
  const out = [];
  const add = (course, key) => {
    if (!key) { out.push(course); return; }
    if (byKey.has(key)) { if (course.completed) byKey.get(key).completed = true; }
    else { byKey.set(key, course); out.push(course); }
  };
  for (const it of planItems) {
    const key = normCode(it.code);
    add({ code: it.code, credits: it.credits, name: it.name, term: it.term, completed: it.status === 'completed' || (key && completedCodes.has(key)) }, key);
  }
  for (const c of completedCourses) {
    const key = normCode(c.courseCode);
    if (key && byKey.has(key)) { byKey.get(key).completed = true; continue; }
    add({ code: c.courseCode, credits: c.credits, name: c.courseTitle || c.courseCode, term: null, completed: true }, key);
  }
  return out;
}
