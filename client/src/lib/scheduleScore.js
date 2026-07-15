/**
 * Semester Schedule Builder — Stage C scoring (pure, deterministic, client-side).
 *
 * The solver (Stage B) produces every conflict-free schedule; this module ranks
 * them against the student's preferences. Plain weighted math — NO AI, NO
 * network. The one Claude call in Stage C is the tradeoff advisor, server-side.
 *
 * Preferences (all optional; absent = no constraint):
 *   { earliestStart:'HH:MM'|null, latestEnd:'HH:MM'|null, daysFree:[tokens],
 *     gapStyle:'minimize'|'spread'|null, fewerDays:bool,
 *     professors:{ [name]: 'prefer'|'avoid' } }
 */
import { toMinutes } from './classMeetings.js';

// All the tunable knobs in one place. Higher score = better fit. Penalties are
// heavy-but-not-excluding: a violating schedule ranks low, it never vanishes
// (the solver already guaranteed it's conflict-free — the student can still pick
// it). Weights are intentionally separated by an order of magnitude so an
// "avoid" professor decisively outranks soft time preferences.
export const WEIGHTS = {
  earlyStartPerHour: -8, // per hour any class starts before earliestStart (summed over meetings)
  lateEndPerHour: -8, // per hour any class ends after latestEnd
  dayFreeBonus: 10, // per requested day that is actually empty
  gapMinimizePerHour: -3, // gapStyle 'minimize': per hour of between-class gaps
  gapSpreadPerHour: 3, // gapStyle 'spread': per hour of gaps, up to the cap
  gapSpreadCapHours: 4, // don't reward unbounded dead time
  campusDayPerDay: -4, // fewerDays: per day on campus
  professorPrefer: 12, // per preferred professor present
  professorAvoid: -30, // per avoided professor present (decisive)
};

const fmt12 = (min) => {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
};

/** Expand a candidate (array of sections) into concrete { day, start, end, section } meetings. */
function meetings(candidate) {
  const out = [];
  for (const s of candidate || []) {
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    if (start == null || end == null) continue;
    for (const d of s.days || []) out.push({ day: d, start, end, section: s });
  }
  return out;
}

/** Sum of between-class gap hours across all days (back-to-back = 0 gap). */
function totalGapHours(ms) {
  const byDay = new Map();
  for (const m of ms) {
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day).push(m);
  }
  let mins = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) mins += Math.max(0, list[i].start - list[i - 1].end);
  }
  return mins / 60;
}

const professorsIn = (ms) => new Set(ms.map((m) => m.section?.professor).filter(Boolean));

/** True if any preference is actually set (else ranking = stable solver order). */
export function prefsActive(prefs = {}) {
  return !!(
    prefs.earliestStart ||
    prefs.latestEnd ||
    (Array.isArray(prefs.daysFree) && prefs.daysFree.length) ||
    prefs.gapStyle ||
    prefs.fewerDays ||
    (prefs.professors && Object.values(prefs.professors).some((v) => v === 'prefer' || v === 'avoid'))
  );
}

/**
 * Score one candidate against the preferences. Returns { score, breakdown } —
 * breakdown keeps each component so ranking, chips, and tests can inspect them.
 */
export function scoreSchedule(candidate, prefs = {}) {
  const ms = meetings(candidate);
  const b = { earlyStart: 0, lateEnd: 0, daysFree: 0, gap: 0, campus: 0, professor: 0 };

  const earliest = toMinutes(prefs.earliestStart);
  const latest = toMinutes(prefs.latestEnd);

  if (earliest != null) {
    let hrs = 0;
    for (const m of ms) if (m.start < earliest) hrs += (earliest - m.start) / 60;
    b.earlyStart = WEIGHTS.earlyStartPerHour * hrs;
  }
  if (latest != null) {
    let hrs = 0;
    for (const m of ms) if (m.end > latest) hrs += (m.end - latest) / 60;
    b.lateEnd = WEIGHTS.lateEndPerHour * hrs;
  }

  const usedDays = new Set(ms.map((m) => m.day));
  if (Array.isArray(prefs.daysFree)) {
    for (const d of prefs.daysFree) if (!usedDays.has(d)) b.daysFree += WEIGHTS.dayFreeBonus;
  }

  const gapH = totalGapHours(ms);
  if (prefs.gapStyle === 'minimize') b.gap = WEIGHTS.gapMinimizePerHour * gapH;
  else if (prefs.gapStyle === 'spread') b.gap = WEIGHTS.gapSpreadPerHour * Math.min(gapH, WEIGHTS.gapSpreadCapHours);

  if (prefs.fewerDays) b.campus = WEIGHTS.campusDayPerDay * usedDays.size;

  if (prefs.professors) {
    for (const p of professorsIn(ms)) {
      if (prefs.professors[p] === 'prefer') b.professor += WEIGHTS.professorPrefer;
      else if (prefs.professors[p] === 'avoid') b.professor += WEIGHTS.professorAvoid;
    }
  }

  const score = b.earlyStart + b.lateEnd + b.daysFree + b.gap + b.campus + b.professor;
  return { score, breakdown: b };
}

const shortProf = (name) => (/^(prof|dr)\.?\s/i.test(name) ? name : `Prof. ${name.split(/\s+/).slice(-1)[0]}`);

/**
 * The concrete compromises a candidate makes against the prefs, as chips. Purely
 * derived from the same signals as the score — no AI. `heavy` marks a chip the
 * UI should style as a strong tradeoff (drives the fit tier).
 */
export function compromises(candidate, prefs = {}) {
  const ms = meetings(candidate);
  const chips = [];

  const earliest = toMinutes(prefs.earliestStart);
  if (earliest != null) {
    const viol = ms.filter((m) => m.start < earliest).sort((a, b) => a.start - b.start)[0];
    if (viol) chips.push({ key: 'early', label: `Starts ${fmt12(viol.start)} ${viol.day}`, heavy: earliest - viol.start >= 60 });
  }
  const latest = toMinutes(prefs.latestEnd);
  if (latest != null) {
    const viol = ms.filter((m) => m.end > latest).sort((a, b) => b.end - a.end)[0];
    if (viol) chips.push({ key: 'late', label: `Ends ${fmt12(viol.end)} ${viol.day}`, heavy: viol.end - latest >= 60 });
  }

  const usedDays = new Set(ms.map((m) => m.day));
  if (Array.isArray(prefs.daysFree)) {
    for (const d of prefs.daysFree) if (usedDays.has(d)) chips.push({ key: `day-${d}`, label: `${d} on campus`, heavy: false });
  }
  if (prefs.fewerDays && usedDays.size >= 5) {
    chips.push({ key: 'campus', label: `${usedDays.size} days on campus`, heavy: false });
  }
  if (prefs.professors) {
    for (const p of professorsIn(ms)) {
      if (prefs.professors[p] === 'avoid') chips.push({ key: `prof-${p}`, label: `${shortProf(p)} (avoided)`, heavy: true });
    }
  }
  if (prefs.gapStyle === 'minimize') {
    const g = totalGapHours(ms);
    if (g >= 2) chips.push({ key: 'gaps', label: `${Math.round(g)}h of gaps`, heavy: false });
  }
  return chips;
}

/** Fit tier for a ranked entry, from its compromises (great / good / compromise). */
function tierFor(chips) {
  if (!chips.length) return 'great';
  if (chips.some((c) => c.heavy)) return 'compromise';
  return chips.length <= 2 ? 'good' : 'compromise';
}

/**
 * Rank the solver's schedules best-first. Deterministic: sort by score desc,
 * ties broken by the original solver index (stable). With no active preferences
 * every score is 0, so the solver's order is preserved untouched.
 *
 * Returns [{ schedule, solverIndex, score, breakdown, compromises, tier }].
 */
export function rankSchedules(schedules, prefs = {}) {
  const active = prefsActive(prefs);
  const scored = (schedules || []).map((schedule, i) => {
    const { score, breakdown } = scoreSchedule(schedule, prefs);
    const chips = active ? compromises(schedule, prefs) : [];
    return { schedule, solverIndex: i, score, breakdown, compromises: chips, tier: active ? tierFor(chips) : null };
  });
  scored.sort((a, b) => b.score - a.score || a.solverIndex - b.solverIndex);
  return scored;
}
