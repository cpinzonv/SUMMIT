/**
 * Degree Requirements — Stage R3 auto-fill (pure, framework-free). Deterministic
 * distribution: spreads the student's remaining REQUIRED courses across their
 * future semesters, respecting prerequisites, course offerings, and per-semester
 * credit balance. NO AI — topological ordering + constrained placement.
 *
 * Every placement decision is validated through the SAME canPlace the manual
 * drag/move flow uses (R2). This module only decides WHICH course goes WHERE and
 * in what order; canPlace decides whether a slot is legal.
 *
 * distributePlan(...) → { placements, unplaceable, trayItems }. It never mutates
 * the plan — the UI previews these and commits on Apply. Already-placed and
 * completed courses are FIXED: auto-fill fills around them, never moving them.
 */
import { normCode } from './requirementProgress.js';
import { canPlace, semesterOrder, isCourseToken, SEASON_RANK } from './placement.js';

export const AUTOFILL_DEFAULTS = { target: 15, max: 18, min: 12, summerMax: 8 };

const key = (s) => `${s.season} ${s.year}`;

/** A chronological run of `count` semesters from `start`, optionally with summers. */
export function generateSemesters(start, count, includeSummer) {
  const seasons = includeSummer ? ['Spring', 'Summer', 'Fall'] : ['Spring', 'Fall'];
  let year = Number(start.year);
  let idx = seasons.indexOf(start.season);
  if (idx === -1) {
    // Start season isn't in the set (Summer excluded, or Winter): jump to the
    // next chronological season, wrapping to next year if none remain.
    const startRank = SEASON_RANK[start.season] || 0;
    idx = seasons.findIndex((s) => SEASON_RANK[s] >= startRank);
    if (idx === -1) { idx = 0; year += 1; }
  }
  const out = [];
  while (out.length < count) {
    out.push({ season: seasons[idx], year });
    idx += 1;
    if (idx >= seasons.length) { idx = 0; year += 1; }
  }
  return out;
}

/** Deterministic topological sort (ties broken by code). Returns { order, cycle }. */
export function topoSort(nodes, deps) {
  const inDeg = new Map();
  const dependents = new Map();
  for (const n of nodes) { inDeg.set(n, 0); dependents.set(n, []); }
  for (const n of nodes) {
    for (const d of deps.get(n) || []) {
      if (!inDeg.has(d)) continue;
      inDeg.set(n, inDeg.get(n) + 1);
      dependents.get(d).push(n);
    }
  }
  const ready = [...nodes].filter((n) => inDeg.get(n) === 0).sort();
  const order = [];
  while (ready.length) {
    const n = ready.shift();
    order.push(n);
    for (const m of dependents.get(n)) {
      inDeg.set(m, inDeg.get(m) - 1);
      if (inDeg.get(m) === 0) { ready.push(m); ready.sort(); }
    }
  }
  const placed = new Set(order);
  return { order, cycle: [...nodes].filter((n) => !placed.has(n)) };
}

export function distributePlan({ categories = [], index, semesters = [], plan = [], completed = new Set(), options = {} } = {}) {
  const opt = { ...AUTOFILL_DEFAULTS, ...options };
  const done = new Set([...(completed instanceof Set ? completed : new Set(completed || []))].map(normCode));
  const placedCodes = new Set(plan.map((p) => normCode(p.code)));
  const fixed = (k) => done.has(k) || placedCodes.has(k);
  const prereqsOf = (k) => index.get(k)?.prereqGroups || [];
  const creditsOf = (k) => Number(index.get(k)?.credits) || 0;

  const sems = [...semesters].sort((a, b) => semesterOrder(a.season, a.year) - semesterOrder(b.season, b.year));

  const groupSatByFixed = (group) => group.some((m) => fixed(normCode(m)));
  const groupSat = (group, must) => group.some((m) => { const k = normCode(m); return fixed(k) || must.has(k); });

  // OR-group satisfier: a course member with the fewest own prereqs; ties by code.
  // A group of only non-course tokens (e.g. "PLACEMENT") has no auto-satisfier.
  const chooseSatisfier = (group) => {
    const members = group.filter((m) => isCourseToken(m) && index.has(normCode(m)) && !fixed(normCode(m))).map(normCode);
    if (!members.length) return null;
    members.sort((a, b) => prereqsOf(a).length - prereqsOf(b).length || (a < b ? -1 : a > b ? 1 : 0));
    return members[0];
  };

  /* ---- Phase A: which courses MUST be placed (quota + prereq closure) ---- */
  const catOf = new Map(); // normCode → categoryId (first listing)
  const trayItems = [];
  const must = new Set();

  for (const cat of categories) {
    const catCourses = (cat.courses || []).map((c) => ({ k: normCode(c.courseCode), code: c.courseCode, credits: Number(c.credits) || 0 }));
    for (const c of catCourses) if (c.k && !catOf.has(c.k)) catOf.set(c.k, cat.id);
    const requiredRemaining = Math.max(0, (Number(cat.creditsRequired) || 0) - (Number(cat.satisfiedCredits) || 0));
    if (requiredRemaining <= 0) continue; // category already satisfied

    const available = catCourses.filter((c) => c.k && !fixed(c.k));
    if (!available.length) {
      // rule-only (no course rows) or all listed courses already done → needs input
      trayItems.push({ categoryId: cat.id, categoryName: cat.name, remainingCredits: requiredRemaining, candidates: [], ruleOnly: true });
      continue;
    }
    const availableCredits = available.reduce((t, c) => t + c.credits, 0);
    if (availableCredits <= requiredRemaining) {
      for (const c of available) must.add(c.k); // all needed to reach the quota
    } else {
      // pick-N: the engine does NOT choose — the student picks from the tray.
      trayItems.push({ categoryId: cat.id, categoryName: cat.name, remainingCredits: requiredRemaining, candidates: available.map((c) => ({ code: c.code, credits: c.credits })), ruleOnly: false });
    }
  }

  // Closure: prereqs of anything that will be placed (must ∪ already-placed) are
  // forced in — a prereq of a required/placed course isn't really optional.
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...must, ...placedCodes]) {
      for (const group of prereqsOf(k)) {
        if (!group.length || groupSat(group, must)) continue;
        const s = chooseSatisfier(group);
        if (s && !must.has(s)) { must.add(s); changed = true; }
      }
    }
  }

  // A tray candidate that got forced in is no longer optional — drop it and
  // reduce that category's remaining credits.
  for (const t of trayItems) {
    if (!t.candidates.length) continue;
    const forced = t.candidates.filter((c) => must.has(normCode(c.code)));
    if (forced.length) {
      t.candidates = t.candidates.filter((c) => !must.has(normCode(c.code)));
      t.remainingCredits = Math.max(0, t.remainingCredits - forced.reduce((s, c) => s + (c.credits || 0), 0));
    }
  }
  const finalTray = trayItems.filter((t) => t.remainingCredits > 0 && (t.ruleOnly || t.candidates.length));

  /* ---- Phase B: topological order + cycle detection ---- */
  const deps = new Map();
  for (const k of must) {
    const d = new Set();
    for (const group of prereqsOf(k)) {
      if (!group.length || groupSatByFixed(group)) continue; // satisfied by completed/placed
      const inMust = group.map(normCode).filter((m) => must.has(m));
      if (inMust.length) {
        inMust.sort((a, b) => prereqsOf(a).length - prereqsOf(b).length || (a < b ? -1 : 1));
        d.add(inMust[0]);
      }
    }
    deps.set(k, d);
  }
  const { order, cycle } = topoSort(must, deps);

  const unplaceable = [];
  if (cycle.length) {
    const names = cycle.map((c) => index.get(c)?.code || c);
    for (const c of cycle) unplaceable.push({ code: index.get(c)?.code || c, reason: `${names.join(' and ')} require each other — fix one prerequisite.` });
  }

  /* ---- Phase C: place in order, balancing credits, respecting canPlace ---- */
  const load = new Map();
  for (const p of plan) load.set(key(p), (load.get(key(p)) || 0) + (Number(p.credits) || 0));
  const semMax = (s) => (s.season === 'Summer' ? opt.summerMax : opt.max);
  const semTarget = (s) => Math.min(opt.target, semMax(s));

  // A must-course a PLACED course depends on must land strictly before it.
  const upperBound = new Map();
  for (const p of plan) {
    for (const group of prereqsOf(normCode(p.code))) {
      if (!group.length || groupSatByFixed(group)) continue;
      const inMust = group.map(normCode).filter((m) => must.has(m));
      if (inMust.length) {
        const s = inMust[0];
        upperBound.set(s, Math.min(upperBound.get(s) ?? Infinity, semesterOrder(p.season, p.year)));
      }
    }
  }

  const placedThisRun = [];
  const placements = [];
  const cycleSet = new Set(cycle);
  for (const k of order) {
    if (cycleSet.has(k)) continue; // reported above
    const course = index.get(k);
    if (!course) continue;
    const credits = creditsOf(k);
    const ub = upperBound.get(k) ?? Infinity;
    const runningPlan = [...plan, ...placedThisRun];

    // Pick the earliest of the LOWEST-loaded feasible semesters — even balance,
    // while topo order + earliest-tie keeps long chains scheduled early.
    const pick = (capFn) => {
      let best = null;
      let bestLoad = Infinity;
      for (const sem of sems) {
        if (semesterOrder(sem.season, sem.year) >= ub) break;
        const l = load.get(key(sem)) || 0;
        if (l + credits > capFn(sem)) continue;
        if (!canPlace(course, sem, runningPlan, done).ok) continue;
        if (l < bestLoad) { bestLoad = l; best = sem; } // strict < → earliest wins ties
      }
      return best;
    };

    const sem = pick(semTarget) || pick(semMax);
    if (sem) {
      load.set(key(sem), (load.get(key(sem)) || 0) + credits);
      const placedEntry = { code: course.code, season: sem.season, year: sem.year, credits, offeredTerms: course.offeredTerms, prereqGroups: course.prereqGroups };
      placedThisRun.push(placedEntry);
      placements.push({ code: course.code, season: sem.season, year: sem.year, credits, categoryId: catOf.get(k) ?? null });
    } else {
      const terms = course.offeredTerms;
      const inScope = new Set(sems.map((s) => s.season));
      const reason = Array.isArray(terms) && terms.length && !terms.some((t) => inScope.has(t))
        ? `no remaining semester is a ${terms.join('/')} term for ${course.code}.`
        : `no remaining semester fits ${course.code} after its prerequisites — free up credit space or add a semester.`;
      unplaceable.push({ code: course.code, reason });
    }
  }

  return { placements, unplaceable, trayItems: finalTray };
}
