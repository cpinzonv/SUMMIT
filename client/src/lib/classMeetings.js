/**
 * Single client-side source of truth for a class's meeting schedule.
 *
 * The rich model — `class.syllabus.meetingTimes = [{ day, start, end, location }]`
 * — is authoritative. `day` is a weekday token ('Mon'..'Sun'); `start`/`end` are
 * local wall-clock 'HH:MM' strings (never UTC — recurring classes must not shift
 * with DST). For classes saved before the schedule editor wrote meetingTimes we
 * fall back to the legacy flat `meetingDays` + `meetingTime` pair so they still
 * render. BOTH the Schedule timetable and the calendar consume this module, so
 * they can never disagree.
 */

// Weekday token → JS Date.getDay() index. Matches the server's generateSessionDates.
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Robust weekday → 0..6 (accepts 'Mon', 'MON', 'monday', …). -1 if unknown. */
export function dayIndex(token) {
  if (token == null) return -1;
  const k = String(token).slice(0, 3).toLowerCase();
  const key = k.charAt(0).toUpperCase() + k.slice(1);
  return key in DAY_INDEX ? DAY_INDEX[key] : -1;
}

/** 'HH:MM' (or 'H:MM am/pm') → minutes since midnight, or null. */
export function toMinutes(str) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(String(str || '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) { h %= 12; if (/pm/i.test(m[3])) h += 12; }
  return h * 60 + min;
}

/**
 * Normalize any class to the rich meeting shape: [{ day, start, end, location }].
 * Prefers syllabus.meetingTimes; falls back to the legacy flat fields. Entries
 * without a resolvable day are dropped.
 */
export function normalizedMeetings(cls) {
  if (!cls) return [];
  const rich = cls.syllabus?.meetingTimes;
  if (Array.isArray(rich) && rich.length) {
    return rich
      .filter((mt) => mt && dayIndex(mt.day) >= 0 && mt.start)
      .map((mt) => ({
        day: mt.day,
        start: mt.start,
        end: mt.end || null,
        location: mt.location || cls.syllabus?.location || null,
      }));
  }
  // Legacy fallback: a flat day list + a single start time (no end).
  if (Array.isArray(cls.meetingDays) && cls.meetingDays.length && cls.meetingTime) {
    return cls.meetingDays
      .filter((d) => dayIndex(d) >= 0)
      .map((day) => ({ day, start: cls.meetingTime, end: null, location: cls.syllabus?.location || null }));
  }
  return [];
}

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseDate = (str) => {
  if (!str) return null;
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? new Date(y, m - 1, d) : null;
};

/**
 * Expand a class's recurring schedule into concrete dated sessions. One session
 * per matching weekday between the class's start and end dates (each optionally
 * clamped to the caller's visible window via `from`/`to`). Times are carried
 * through as wall-clock 'HH:MM' — no timezone conversion.
 *
 * Returns [{ date:'YYYY-MM-DD', day, start, end, startMin, endMin, location, cls }]
 * sorted by date then start time. Structured so a future overlap check can scan
 * same-day sessions across classes by [startMin, endMin).
 */
export function generateClassSessions(cls, { from, to } = {}) {
  const meetings = normalizedMeetings(cls);
  if (meetings.length === 0) return [];

  // Range = class [startDate,endDate] intersected with the caller's window.
  // If the class has no bounds, fall back to the window so it still renders.
  const lo = maxDate(parseDate(cls.startDate), parseDate(from));
  const hi = minDate(parseDate(cls.endDate), parseDate(to));
  const start = lo ?? parseDate(from);
  const end = hi ?? parseDate(to);
  if (!start || !end || start > end) return [];

  // Bucket meetings by weekday index for a single linear scan of the range.
  const byWeekday = new Map();
  for (const mt of meetings) {
    const idx = dayIndex(mt.day);
    if (!byWeekday.has(idx)) byWeekday.set(idx, []);
    byWeekday.get(idx).push(mt);
  }

  const out = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 3000) {
    const todays = byWeekday.get(cur.getDay());
    if (todays) {
      const date = fmtDate(cur);
      for (const mt of todays) {
        out.push({
          date,
          day: mt.day,
          start: mt.start,
          end: mt.end,
          startMin: toMinutes(mt.start),
          endMin: toMinutes(mt.end),
          location: mt.location,
          cls,
        });
      }
    }
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  out.sort((a, b) => (a.date === b.date ? (a.startMin ?? 0) - (b.startMin ?? 0) : a.date < b.date ? -1 : 1));
  return out;
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
