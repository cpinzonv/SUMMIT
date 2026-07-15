import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, classGradient } from '../components/ui';
import { EmptyHero, ScheduleIllustration } from '../components/EmptyHero';
import { WeekGrid } from '../components/WeekGrid';
import { normalizedMeetings } from '../lib/classMeetings';

/**
 * Weekly timetable: time on the Y axis (8am–6pm), weekdays on the X axis. Class
 * meeting blocks are positioned by start/end time and colored by the class
 * color. Overlapping blocks on the same day are flagged as conflicts. On narrow
 * screens the days stack vertically.
 */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const START_HOUR = 8;
const END_HOUR = 18;

function dayToIndex(day) {
  if (day == null) return -1;
  const k = String(day).trim().slice(0, 3).toLowerCase();
  return k in DAY_INDEX ? DAY_INDEX[k] : -1;
}

/** Parse "HH:MM" (or "H:MM AM/PM") → minutes since midnight, or null. */
function toMinutes(t) {
  if (!t) return null;
  const s = String(t).trim();
  let m = /^(\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(s);
  if (!m) {
    m = /^(\d{1,2})\s*([ap]m)$/i.exec(s);
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[2])) h += 12;
    return h * 60;
  }
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3];
  if (ap) {
    h = h % 12;
    if (/pm/i.test(ap)) h += 12;
  }
  return h * 60 + min;
}

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

/** Build timetable blocks for a class from its meeting data. */
function classBlocks(cls, index) {
  const gradient = classGradient(cls, index);
  const out = [];
  // Single source of truth (rich meetingTimes, or legacy flat fields as fallback)
  // — shared with the calendar so the two views can never disagree.
  for (const mt of normalizedMeetings(cls)) {
    const d = dayToIndex(mt.day);
    const start = toMinutes(mt.start);
    if (d < 0 || start == null) continue;
    const end = toMinutes(mt.end) ?? start + 50;
    out.push({ cls, gradient, day: d, start, end, location: mt.location || null });
  }
  return out;
}

/** Mark blocks that overlap another block on the same day as conflicts. */
function markConflicts(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.day === b.day && a.start < b.end && b.start < a.end) {
        a.conflict = true;
        b.conflict = true;
      }
    }
  }
  return blocks;
}

/**
 * The weekly timetable body (no page heading), so it can be embedded — e.g. as
 * the Planner's "Schedule" sub-view. All timetable/conflict logic is unchanged.
 */
export function ScheduleView() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/api/classes')
      .then((r) => setClasses(r.data.classes))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const blocks = useMemo(() => {
    const all = [];
    classes.forEach((c, i) => all.push(...classBlocks(c, i)));
    return markConflicts(all);
  }, [classes]);

  const hasConflicts = blocks.some((b) => b.conflict);

  // Adapt this view's blocks to the shared WeekGrid's block shape. Same fixed
  // 8am–6pm, Mon–Fri frame the timetable has always used.
  const gridBlocks = blocks.map((b, k) => ({
    key: k,
    dayIdx: b.day,
    startMin: b.start,
    endMin: b.end,
    title: b.cls.name,
    subtitle: `${fmtMinutes(b.start)}–${fmtMinutes(b.end)}`,
    detail: b.location || null,
    gradient: b.gradient,
    conflict: b.conflict,
    hoverTitle: `${b.cls.name} · ${fmtMinutes(b.start)}–${fmtMinutes(b.end)}${b.location ? ` · ${b.location}` : ''}`,
    onClick: () => navigate(`/classes/${b.cls.id}`),
  }));

  if (loading) return <Spinner label="Loading schedule…" />;

  return (
    <div>
      <ErrorBanner message={error} />
      {hasConflicts && (
        <div className="mb-4 rounded-2xl border border-rose-300/50 bg-rose-50/70 px-4 py-2.5 text-sm font-medium text-rose-700">
          Heads up — some candidate sections overlap. Those blocks are outlined in red so you can spot clashes before you register.
        </div>
      )}

      {blocks.length === 0 ? (
        <EmptyHero
          illustration={<ScheduleIllustration />}
          headline="Preview a semester before you register"
          subheading="As you plan courses, this shows where their meeting times would land across the week — a future-semester preview, separate from your live week in the Schedule tab."
          ctaLabel="+ Add class times"
          onCta={() => navigate('/')}
        />
      ) : (
        <WeekGrid blocks={gridBlocks} days={DAYS} startHour={START_HOUR} endHour={END_HOUR} />
      )}
    </div>
  );
}
