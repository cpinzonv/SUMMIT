/**
 * Degree Requirements — Stage R1 progress (pure, client-side).
 *
 * Given the courses in the student's 4-year plan and their degree's requirement
 * categories, compute per-category "satisfied credits". Plain matching by
 * course code — no AI, no network.
 *
 * Rules (kept here so they're easy to find and test):
 *  - Matching is by NORMALIZED course_code: upper-cased, all whitespace removed,
 *    so "math 162", "MATH162", and "MATH 162" all match.
 *  - A planned course that matches courses in MULTIPLE categories counts toward
 *    exactly ONE — the FIRST category (in display order) that lists its code.
 *    So each requirement code is "owned" by the first category listing it, and a
 *    planned course is never double-counted.
 *  - "Satisfied" uses the PLANNED course's own credits (what the student put in
 *    their plan). A matched course with no credits still counts as matched but
 *    adds 0 credits.
 *  - A planned course that matches no requirement course still counts toward the
 *    overall total and is returned under `notMatched` — nothing silently
 *    disappears. Rule-only categories (no explicit course list, e.g. "9 credits
 *    from any 300-level HIST") can't be auto-matched this stage, so such courses
 *    land in notMatched by design.
 *  - R2: each course may carry `completed: true` (completed/transferred). A
 *    category's satisfied credits are split into completed vs planned so the UI
 *    can render solid vs hatched segments; both count toward "satisfied".
 */

export const normCode = (code) => String(code || '').toUpperCase().replace(/\s+/g, '');

export function computeRequirementProgress(planItems = [], categories = []) {
  // Ownership map: requirement course_code → index of the FIRST category listing
  // it (first-match wins → no double counting).
  const codeToCat = new Map();
  categories.forEach((cat, ci) => {
    for (const co of cat.courses || []) {
      const key = normCode(co.courseCode);
      if (key && !codeToCat.has(key)) codeToCat.set(key, ci);
    }
  });

  const satisfied = categories.map(() => ({ credits: 0, completed: 0, planned: 0, codes: [] }));
  const notMatched = [];
  let overallPlannedCredits = 0;
  let overallCompletedCredits = 0;

  for (const item of planItems) {
    const credits = Number(item.credits) || 0;
    const done = !!item.completed;
    if (done) overallCompletedCredits += credits;
    else overallPlannedCredits += credits;
    const key = normCode(item.code);
    const ci = key ? codeToCat.get(key) : undefined;
    if (ci == null) {
      notMatched.push({ code: item.code ?? null, name: item.name ?? null, credits: item.credits ?? null, term: item.term ?? null, completed: done });
    } else {
      satisfied[ci].credits += credits;
      satisfied[ci][done ? 'completed' : 'planned'] += credits;
      satisfied[ci].codes.push(item.code);
    }
  }

  const cats = categories.map((cat, ci) => ({
    ...cat,
    satisfiedCredits: satisfied[ci].credits,
    completedCredits: satisfied[ci].completed,
    plannedCredits: satisfied[ci].planned,
    matchedCodes: satisfied[ci].codes,
  }));

  return {
    categories: cats,
    overallPlannedCredits,
    overallCompletedCredits,
    satisfiedTotal: satisfied.reduce((t, s) => t + s.credits, 0),
    requiredTotal: categories.reduce((t, c) => t + (Number(c.creditsRequired) || 0), 0),
    notMatched,
  };
}
