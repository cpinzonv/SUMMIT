/**
 * Weekly workload prediction — sums estimated effort (hours) for a user's
 * upcoming assignments into a scrollable series of weeks (Mon–Sun), each with a
 * per-day breakdown, its assignment list, and a "can I finish?" feasibility read.
 *
 * Scheduling axis is COALESCE(planned_date, due_date): if the student planned
 * when they'll do the work, that drives the workload; otherwise the due date does.
 *
 * When an assignment has no estimated_hours (e.g. no AI estimate yet), a
 * heuristic fallback is applied (see estimateHours) so the totals are still
 * useful out of the box. Assignments with a stored estimated_hours (AI time
 * estimate or manual entry) use that exact value.
 *
 * Feasibility compares a week's hours against the study time realistically
 * available (whole days remaining in the current week — or a full 7 for future
 * weeks — times ~DAILY_CAPACITY_HOURS; past weeks have no capacity left).
 */
import { query } from '../config/db.js';

// Assumed focused study hours available per day — drives the feasibility verdict.
const DAILY_CAPACITY_HOURS = 4;
// How far the scrollable window may extend past/future from the current week.
const MAX_WEEKS_BACK = 8;
const MAX_WEEKS_FWD = 16;
const MS_WEEK = 7 * 24 * 3600 * 1000;

/** Heuristic hour estimate from category/title + point value (server-side mirror
 *  of the client suggestion, used only when estimated_hours is unset). */
export function estimateHours({ category, title, pointValue }) {
  const text = `${category || ''} ${title || ''}`.toLowerCase();
  const pts = Number(pointValue) || 0;
  const bump = pts >= 100 ? 2 : pts >= 50 ? 1 : 0;
  if (/essay|paper|report|writing/.test(text)) return 3 + bump + (pts >= 100 ? 2 : 0); // 3–8h
  if (/exam|midterm|final|test|quiz/.test(text)) return 2 + bump + (pts >= 100 ? 1 : 0); // 2–5h
  if (/problem set|pset|homework|hw|assignment/.test(text)) return 1 + bump; // 1–4h
  if (/reading|chapter|read/.test(text)) return 1 + (pts >= 50 ? 1 : 0); // 1–2h
  if (/project|lab/.test(text)) return 3 + bump;
  return 2; // sensible default
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}

const round = (n) => Math.round(n * 10) / 10;
const msDay = 24 * 3600 * 1000;

/** Feasibility for one week given its total hours and how many study-days remain. */
function feasibilityFor(totalHours, daysLeft) {
  const availableHours = daysLeft * DAILY_CAPACITY_HOURS;
  let verdict = 'on_track';
  if (totalHours > availableHours) verdict = 'overloaded';
  else if (totalHours > availableHours * 0.8) verdict = 'tight';
  return {
    dailyHours: DAILY_CAPACITY_HOURS,
    daysLeft,
    availableHours,
    verdict, // 'on_track' | 'tight' | 'overloaded'
    overBy: Math.max(0, round(totalHours - availableHours)),
  };
}

/**
 * Scrollable multi-week workload. Returns a contiguous series of weeks spanning
 * the user's scheduled work (planned_date, else due_date), clamped to a window
 * around the current week, plus the index of the current week.
 */
export async function weeklyWorkload(userId, now = new Date()) {
  const thisWeekStart = startOfWeek(now);
  const today = new Date(now); today.setHours(0, 0, 0, 0);

  // Every not-yet-finished assignment with a schedule date. The scheduling axis
  // is COALESCE(planned_date, due_date) — the planned day wins when it's set.
  const { rows } = await query(
    `SELECT a.id, a.title, a.category, a.point_value, a.estimated_hours, a.due_date,
            COALESCE(a.planned_date, a.due_date) AS deadline,
            (a.planned_date IS NOT NULL) AS planned,
            c.name AS class_name
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
      WHERE c.user_id = $1 AND c.archived_at IS NULL
        AND COALESCE(a.planned_date, a.due_date) IS NOT NULL
        AND a.status NOT IN ('submitted', 'graded')
        AND a.board_stage <> 'done'`,
    [userId],
  );

  // Bucket assignments by their week-start (ms), building the per-week item list.
  const buckets = new Map(); // weekStartMs → { total, items }
  for (const r of rows) {
    const aiEstimated = r.estimated_hours != null;
    const hours = aiEstimated
      ? Number(r.estimated_hours)
      : estimateHours({ category: r.category, title: r.title, pointValue: r.point_value });
    const deadline = new Date(r.deadline);
    const ws = startOfWeek(deadline).getTime();
    if (!buckets.has(ws)) buckets.set(ws, { total: 0, items: [] });
    const b = buckets.get(ws);
    b.total += hours;
    b.items.push({
      id: r.id,
      title: r.title,
      className: r.class_name,
      deadline: r.deadline,       // planned_date ?? due_date — drives the week bucket
      dueDate: r.due_date,        // the real deadline — drives the countdown label
      planned: Boolean(r.planned), // scheduled by planned_date vs. due_date
      hours: round(hours),
      aiEstimated,
    });
  }

  // Window: from the earliest scheduled week (bounded) to the latest (bounded),
  // always including this week and next week so there's something to show.
  const weekKeys = [...buckets.keys()];
  const minBound = thisWeekStart.getTime() - MAX_WEEKS_BACK * MS_WEEK;
  const maxBound = thisWeekStart.getTime() + MAX_WEEKS_FWD * MS_WEEK;
  let startMs = Math.min(thisWeekStart.getTime(), ...(weekKeys.length ? weekKeys : [thisWeekStart.getTime()]));
  let endMs = Math.max(thisWeekStart.getTime() + MS_WEEK, ...(weekKeys.length ? weekKeys : [thisWeekStart.getTime()]));
  startMs = Math.max(startMs, minBound);
  endMs = Math.min(endMs, maxBound);

  const weeks = [];
  let currentIndex = 0;
  for (let ms = startMs; ms <= endMs; ms += MS_WEEK) {
    const wkStart = new Date(ms);
    const bucket = buckets.get(ms) || { total: 0, items: [] };
    const byDay = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(ms + i * msDay).toISOString().slice(0, 10),
      hours: 0,
    }));
    for (const it of bucket.items) {
      const idx = Math.floor((new Date(it.deadline) - wkStart) / msDay);
      if (idx >= 0 && idx < 7) byDay[idx].hours = round(byDay[idx].hours + it.hours);
    }
    bucket.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    // Days of study capacity left in this week: 0 for past weeks, a partial count
    // for the current week (today through Sunday), a full 7 for future weeks.
    const isCurrent = ms === thisWeekStart.getTime();
    const isPast = ms < thisWeekStart.getTime();
    let daysLeft = 7;
    if (isPast) daysLeft = 0;
    else if (isCurrent) daysLeft = 7 - Math.min(6, Math.max(0, Math.floor((today - wkStart) / msDay)));

    if (isCurrent) currentIndex = weeks.length;
    weeks.push({
      weekStart: wkStart.toISOString().slice(0, 10),
      isCurrent,
      isPast,
      totalHours: round(bucket.total),
      byDay,
      items: bucket.items,
      feasibility: feasibilityFor(bucket.total, daysLeft),
    });
  }

  return { weeks, currentIndex };
}
