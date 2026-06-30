/**
 * Weekly workload prediction — sums estimated effort (hours) for a user's
 * upcoming assignments, grouped into "this week" and "next week" (Mon–Sun), with
 * a per-day breakdown for the current week to drive a bar chart.
 *
 * When an assignment has no estimated_hours, a heuristic fallback is applied
 * (see estimateHours) so the totals are still useful out of the box.
 */
import { query } from '../config/db.js';

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

/** Total + per-day workload for this week and next week. */
export async function weeklyWorkload(userId, now = new Date()) {
  const weekStart = startOfWeek(now);
  const nextStart = new Date(weekStart);
  nextStart.setDate(nextStart.getDate() + 7);
  const nextEnd = new Date(nextStart);
  nextEnd.setDate(nextEnd.getDate() + 7);

  // Pull all not-yet-finished assignments due within the two-week window.
  const { rows } = await query(
    `SELECT a.title, a.category, a.point_value, a.estimated_hours, a.due_date
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
      WHERE c.user_id = $1 AND c.archived_at IS NULL
        AND a.due_date IS NOT NULL AND a.due_date >= $2 AND a.due_date < $3
        AND a.status NOT IN ('submitted', 'graded')`,
    [userId, weekStart.toISOString(), nextEnd.toISOString()],
  );

  const byDay = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), hours: 0 };
  });

  let thisWeek = 0;
  let nextWeek = 0;
  for (const r of rows) {
    const hours = r.estimated_hours != null
      ? Number(r.estimated_hours)
      : estimateHours({ category: r.category, title: r.title, pointValue: r.point_value });
    const due = new Date(r.due_date);
    if (due < nextStart) {
      thisWeek += hours;
      const idx = Math.floor((due - weekStart) / (24 * 3600 * 1000));
      if (idx >= 0 && idx < 7) byDay[idx].hours += hours;
    } else {
      nextWeek += hours;
    }
  }

  const round = (n) => Math.round(n * 10) / 10;
  return {
    thisWeek: { totalHours: round(thisWeek), byDay: byDay.map((d) => ({ ...d, hours: round(d.hours) })) },
    nextWeek: { totalHours: round(nextWeek) },
  };
}
