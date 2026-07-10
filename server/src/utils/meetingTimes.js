/**
 * Helpers for the class meeting schedule. `meeting_times` (JSONB
 * [{ day, start, end, location }]) is the single source of truth; `meeting_days`
 * is derived from it so the attendance/grade session generator (which keys off
 * meeting_days) stays correct without a second input. Times are wall-clock
 * 'HH:MM' strings — never converted to UTC, so recurring classes don't shift
 * with DST.
 */

/** Distinct meeting weekdays, in first-seen order. Drives attendance sessions. */
export function meetingDaysFrom(meetingTimes) {
  const seen = new Set();
  const out = [];
  for (const mt of meetingTimes ?? []) {
    if (mt?.day && !seen.has(mt.day)) {
      seen.add(mt.day);
      out.push(mt.day);
    }
  }
  return out;
}

/** Earliest start time across meetings (kept in the legacy meeting_time column
 *  for the attendance tab's compact "days · time" display). */
export function earliestStart(meetingTimes) {
  const starts = (meetingTimes ?? []).map((m) => m?.start).filter(Boolean).sort();
  return starts[0] ?? null;
}
