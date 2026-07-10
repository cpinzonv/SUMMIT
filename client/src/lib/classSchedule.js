/**
 * Form-side helpers that translate between the simple schedule UI (a set of days
 * + one shared start/end/location) and the persisted rich `meetingTimes` array
 * ([{ day, start, end, location }]). The render side (timetable, calendar) lives
 * in classMeetings.js; this side only handles the create/edit forms.
 */

/**
 * Build the `meetingTimes` payload from the form inputs. Returns [] when there's
 * nothing to place on a timetable (no days, or no start time) — the schedule is
 * optional, so a class without a fixed time still saves. Times are wall-clock
 * 'HH:MM' strings; we never convert them.
 */
export function buildMeetingTimes(days, start, end, location) {
  if (!Array.isArray(days) || days.length === 0 || !start) return [];
  return days.map((day) => ({
    day,
    start,
    ...(end ? { end } : {}),
    ...(location ? { location } : {}),
  }));
}

/**
 * Hydrate the form from a saved class. The UI models one shared time range for
 * all selected days, so we take the distinct days and the first entry's
 * start/end/location as the representative values. Falls back to the legacy flat
 * fields for classes saved before meetingTimes existed.
 */
export function scheduleFromClass(cls) {
  const rich = cls?.syllabus?.meetingTimes;
  if (Array.isArray(rich) && rich.length) {
    const days = [];
    for (const mt of rich) if (mt?.day && !days.includes(mt.day)) days.push(mt.day);
    const first = rich[0] || {};
    return {
      days,
      start: first.start || '',
      end: first.end || '',
      location: first.location || cls?.syllabus?.location || '',
    };
  }
  return {
    days: Array.isArray(cls?.meetingDays) ? [...cls.meetingDays] : [],
    start: cls?.meetingTime || '',
    end: '',
    location: cls?.syllabus?.location || '',
  };
}
