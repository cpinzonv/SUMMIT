/**
 * Degree Requirements — Stage R2 placement engine (pure, framework-free).
 *
 * Decides whether a course may sit in a given roadmap semester, enforcing the
 * requirement sheet's prerequisites and course offerings. No React, no network —
 * R3's auto-fill will reuse this, so it stays a plain function of its inputs.
 *
 * Conventions from R1: prereq_groups is an AND of OR-groups — an array of groups
 * where satisfying ANY member of a group satisfies it, and ALL groups must be
 * satisfied. offered_terms is a Fall/Spring/Summer subset, or null/[] = unknown
 * (never block on missing data). Codes are matched normalized (see normCode).
 */
import { normCode } from './requirementProgress.js';

export const SEASON_RANK = { Spring: 1, Summer: 2, Fall: 3, Winter: 4 };

/** Chronological sort key for a semester: year, then season within the year. */
export function semesterOrder(season, year) {
  return (Number(year) || 0) * 10 + (SEASON_RANK[season] || 0);
}

/**
 * A prereq token is a COURSE if it looks like a course code (contains a digit).
 * Everything else (e.g. "PLACEMENT", "instructor permission") is a non-course
 * token, satisfiable only by the student marking "I've met this" (which puts it
 * in the `completed` set).
 */
export function isCourseToken(token) {
  return /\d/.test(String(token || ''));
}

const asSet = (x) => (x instanceof Set ? x : new Set(x || []));

function prereqMessage(course, group) {
  const who = course.code || 'This course';
  const list = group.join(' or ');
  return group.length === 1
    ? `${who} needs ${list} in an earlier semester (or marked completed).`
    : `${who} needs one of ${list} in an earlier semester (or marked completed).`;
}

/**
 * Can `course` be placed in `target` given the current plan + completed set?
 *
 * @param course    { code, offeredTerms, prereqGroups }
 * @param target    { season, year }
 * @param plan      [{ code, season, year }] — other placed courses (a placed
 *                  course counts for a prereq only if STRICTLY earlier than target;
 *                  same-semester does not satisfy — no co-requisites this stage)
 * @param completed Set<string> of normalized codes/tokens the student already has
 *                  (completed/transferred courses + met non-course tokens)
 * @returns { ok, reasons: [{ type:'prereq'|'offering', message, ... }] }
 */
export function canPlace(course, target, plan = [], completed = new Set()) {
  // Normalize the completed set so callers can pass raw codes/tokens ("MATH 161")
  // or already-normalized ones — matching is by normCode throughout.
  const done = new Set([...asSet(completed)].map((x) => normCode(x)));
  const reasons = [];
  const targetOrder = semesterOrder(target.season, target.year);

  // Codes placed strictly earlier than the target semester.
  const earlier = new Set(
    plan.filter((p) => semesterOrder(p.season, p.year) < targetOrder).map((p) => normCode(p.code)),
  );
  const memberMet = (m) => {
    const k = normCode(m);
    if (done.has(k)) return true; // completed course, or a met non-course token
    return isCourseToken(m) && earlier.has(k); // a course placed earlier
  };

  for (const group of course.prereqGroups || []) {
    if (!group.length) continue; // "[]" = no prereqs
    if (!group.some(memberMet)) reasons.push({ type: 'prereq', group, message: prereqMessage(course, group) });
  }

  const terms = course.offeredTerms;
  if (Array.isArray(terms) && terms.length > 0 && !terms.includes(target.season)) {
    reasons.push({
      type: 'offering',
      code: course.code || null,
      offeredTerms: terms,
      message: `${course.code || 'This course'} isn’t offered in ${target.season} (only ${terms.join('/')}).`,
    });
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Can `moved` be moved/placed into `target`? Validates the moved course AND its
 * downstream dependents: if moving it later would strand an already-placed course
 * that needs it in an earlier semester, that's a reason too. Plan entries must
 * carry prereqGroups so dependents can be evaluated.
 *
 * @param moved { code, offeredTerms, prereqGroups }
 * @param plan  [{ code, season, year, offeredTerms, prereqGroups }] — all placed
 *              courses (the moved course's OLD position is replaced by target)
 */
export function canMove(moved, target, plan = [], completed = new Set()) {
  const key = normCode(moved.code);
  const others = plan.filter((p) => normCode(p.code) !== key);
  const movedPlaced = { ...moved, season: target.season, year: target.year };
  const fullPlan = [...others, movedPlaced];

  const reasons = [...canPlace(moved, target, fullPlan, completed).reasons];

  // Downstream: any placed course that depends on `moved` must still be valid.
  for (const dep of others) {
    const refsMoved = (dep.prereqGroups || []).some((g) => g.some((t) => normCode(t) === key));
    if (!refsMoved) continue;
    const depRes = canPlace(dep, { season: dep.season, year: dep.year }, fullPlan, completed);
    // Only report the breakage this move causes — an unsatisfied group that
    // still references the moved course (its alternatives, if any, didn't cover it).
    if (depRes.reasons.some((r) => r.type === 'prereq' && r.group.some((t) => normCode(t) === key))) {
      reasons.push({
        type: 'downstream',
        dependent: dep.code,
        moved: moved.code,
        message: `Moving ${moved.code} to ${target.season} ${target.year} would strand ${dep.code} (${dep.season} ${dep.year}), which needs ${moved.code} in an earlier semester.`,
      });
    }
  }

  return { ok: reasons.length === 0, reasons };
}
