/**
 * Semester Schedule Builder — Stage B solver (pure, deterministic, client-side).
 *
 * Given the courses a student saved in their draft plan, enumerate every
 * conflict-free way to pick one section per Required course (and optionally one
 * per Optional course). This is plain combinatorial math — NO AI, NO network.
 *
 * Conventions match the rest of the app: days are weekday tokens ('Mon'..'Sun'),
 * times are wall-clock 'HH:MM'. We lean on classMeetings' dayIndex/toMinutes so
 * the solver, the timetable, and the calendar all read times the same way.
 */
import { dayIndex, toMinutes } from './classMeetings.js';

export const DEFAULT_MAX_COMBINATIONS = 2000; // scale guard: prune optionals past this
const HARD_CAP = 5000; // absolute ceiling on enumerated schedules (pathological input)

// meetingBlocks is called repeatedly during backtracking; memoize per section
// object so overlap checks stay cheap even at the scale-guard ceiling.
const blockCache = new WeakMap();

/**
 * A section's concrete meeting blocks: [{ dayIdx, start, end }] in minutes.
 * Empty when the section can't be placed on a grid (no resolvable day, or a
 * missing/degenerate time range) — i.e. it is "unschedulable" for solving.
 */
export function meetingBlocks(section) {
  if (!section || typeof section !== 'object') return [];
  if (blockCache.has(section)) return blockCache.get(section);
  const days = Array.isArray(section.days) ? section.days : [];
  const start = toMinutes(section.startTime);
  const end = toMinutes(section.endTime);
  let blocks = [];
  if (start != null && end != null && end > start) {
    blocks = days
      .map((d) => dayIndex(d))
      .filter((idx) => idx >= 0)
      .map((dayIdx) => ({ dayIdx, start, end }));
  }
  blockCache.set(section, blocks);
  return blocks;
}

/** A section can only be solved with if it has ≥1 day and a valid [start,end). */
export function isSchedulable(section) {
  return meetingBlocks(section).length > 0;
}

/**
 * Two sections conflict iff they share a weekday AND their [start, end) minute
 * intervals overlap on it. Half-open on purpose: a 10:00–10:50 and an
 * 10:50–11:40 back-to-back on the same day do NOT conflict; the same clock time
 * on different days does NOT conflict.
 */
export function sectionsConflict(a, b) {
  const A = meetingBlocks(a);
  const B = meetingBlocks(b);
  for (const x of A) {
    for (const y of B) {
      if (x.dayIdx === y.dayIdx && x.start < y.end && y.start < x.end) return true;
    }
  }
  return false;
}

const byCode = (a, b) => String(a.code || '').localeCompare(String(b.code || ''));
const bySection = (a, b) =>
  String(a.sectionNumber || '').localeCompare(String(b.sectionNumber || '')) ||
  String(a.id || '').localeCompare(String(b.id || ''));

/**
 * Split each course into its usable candidate sections, applying pins:
 * if any schedulable section of a course is pinned, ONLY the pinned section(s)
 * are candidates for that course. Unschedulable sections are collected (never
 * silently dropped) so the UI can flag them.
 */
function prepareCourses(courses) {
  const unschedulable = [];
  const prepared = [];
  for (const c of courses || []) {
    const sections = Array.isArray(c.sections) ? c.sections : [];
    const schedulable = [];
    for (const s of sections) {
      if (isSchedulable(s)) schedulable.push(s);
      else unschedulable.push({ courseCode: c.code ?? s.courseCode ?? null, sectionNumber: s.sectionNumber ?? null, id: s.id });
    }
    const pinned = schedulable.filter((s) => s.pinned);
    const candidates = (pinned.length ? pinned : schedulable).slice().sort(bySection);
    prepared.push({
      code: c.code ?? '',
      title: c.title ?? null,
      required: c.required !== false, // default Required
      candidates,
      pinned: pinned.slice().sort(bySection),
    });
  }
  prepared.sort(byCode);
  return { prepared, unschedulable };
}

// Raw number of combinations to consider: a Required course contributes one
// choice per candidate; an Optional course also gets a "skip" option (+1).
function rawCount(prepared) {
  return prepared.reduce((n, c) => n * (c.required ? c.candidates.length : c.candidates.length + 1), 1);
}

/** Drop the largest Optional courses until the raw combination count fits the cap. */
function applyScaleGuard(prepared, cap) {
  let working = prepared.slice();
  const pruned = [];
  while (rawCount(working) > cap) {
    // Biggest optional first — it removes the most combinations per drop.
    const optionals = working
      .filter((c) => !c.required)
      .sort((a, b) => b.candidates.length + 1 - (a.candidates.length + 1));
    if (!optionals.length) break; // only Required courses remain; can't prune further
    const drop = optionals[0];
    pruned.push(drop.code);
    working = working.filter((c) => c !== drop);
  }
  return { working, pruned };
}

function conflictsWithChosen(section, chosen) {
  for (const c of chosen) {
    if (c && sectionsConflict(section, c)) return true;
  }
  return false;
}

/** Backtracking enumeration with early conflict pruning. Deterministic order. */
function enumerate(prepared, hardCap) {
  const results = [];
  let truncated = false;

  const backtrack = (i, chosen) => {
    if (truncated) return;
    if (results.length >= hardCap) {
      truncated = true;
      return;
    }
    if (i === prepared.length) {
      const picked = chosen.filter(Boolean);
      if (picked.length) results.push(picked); // an empty pick isn't a "schedule"
      return;
    }
    const course = prepared[i];
    // Optionals try each section first, then "skip" (null) last, so fuller
    // schedules enumerate before sparser ones — order only, never a score.
    const options = course.required ? course.candidates : [...course.candidates, null];
    for (const sec of options) {
      if (results.length >= hardCap) {
        truncated = true;
        return;
      }
      if (sec && conflictsWithChosen(sec, chosen)) continue;
      chosen.push(sec);
      backtrack(i + 1, chosen);
      chosen.pop();
    }
  };

  backtrack(0, []);
  return { results, truncated };
}

/**
 * Why did we get zero schedules? Returns the most actionable reason plus the
 * pairs of sections that overlap, so the UI can point at what to change.
 */
function diagnoseZero(prepared) {
  const requiredEmpty = prepared.filter((c) => c.required && c.candidates.length === 0).map((c) => c.code);
  const hasAnyCandidate = prepared.some((c) => c.candidates.length > 0);
  if (!hasAnyCandidate) return { reason: { type: 'no-sections' }, conflictPairs: [] };
  if (requiredEmpty.length) return { reason: { type: 'required-empty', courses: requiredEmpty }, conflictPairs: [] };

  // All required courses have candidates but nothing combines: find overlaps
  // between candidates of different courses.
  const conflictPairs = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      for (const a of prepared[i].candidates) {
        for (const b of prepared[j].candidates) {
          if (sectionsConflict(a, b)) conflictPairs.push([a, b]);
        }
      }
    }
  }

  // Pin-aware message: a pinned section that clashes with EVERY candidate of
  // another required course is the exact blocker to name.
  for (const p of prepared) {
    if (!p.pinned.length) continue;
    for (const pin of p.pinned) {
      const blocked = prepared.find(
        (o) => o !== p && o.required && o.candidates.length > 0 && o.candidates.every((s) => sectionsConflict(pin, s)),
      );
      if (blocked) {
        return {
          reason: { type: 'pin-conflict', pinnedCourse: p.code, pinnedSection: pin, blockedCourse: blocked.code },
          conflictPairs: conflictPairs.slice(0, 12),
        };
      }
    }
  }
  return { reason: { type: 'conflicts' }, conflictPairs: conflictPairs.slice(0, 12) };
}

/**
 * Generate every conflict-free schedule.
 *
 * @param {Array} courses  [{ code, title?, required?, sections: [section] }]
 *   section: { id, courseCode, sectionNumber, days[], startTime, endTime, professor?, location?, pinned? }
 * @param {object} [opts]
 * @param {number} [opts.maxCombinations] scale-guard cap (default 2000)
 * @returns {{
 *   schedules: Array<Array<section>>, count: number, truncated: boolean,
 *   rawCombinations: number, prunedOptional: string[],
 *   unschedulable: Array<{courseCode, sectionNumber, id}>,
 *   reason: object|null, conflictPairs: Array<[section, section]>
 * }}
 */
export function generateSchedules(courses, opts = {}) {
  const cap = Number.isFinite(opts.maxCombinations) ? opts.maxCombinations : DEFAULT_MAX_COMBINATIONS;
  const { prepared, unschedulable } = prepareCourses(courses);
  const rawCombinations = rawCount(prepared);

  // A Required course with no schedulable/pinned section can never be satisfied
  // — say so immediately rather than enumerating nothing.
  const requiredEmpty = prepared.some((c) => c.required && c.candidates.length === 0);

  let working = prepared;
  let prunedOptional = [];
  if (!requiredEmpty) {
    const guarded = applyScaleGuard(prepared, cap);
    working = guarded.working;
    prunedOptional = guarded.pruned;
  }

  const { results, truncated } = requiredEmpty ? { results: [], truncated: false } : enumerate(working, HARD_CAP);

  const base = {
    schedules: results,
    count: results.length,
    truncated,
    rawCombinations,
    prunedOptional,
    unschedulable,
    reason: null,
    conflictPairs: [],
  };
  if (results.length === 0) {
    const { reason, conflictPairs } = diagnoseZero(prepared);
    return { ...base, reason, conflictPairs };
  }
  return base;
}
