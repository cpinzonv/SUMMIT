import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, classGradient } from '../components/ui';
import { EmptyHero, ScheduleIllustration } from '../components/EmptyHero';
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
const HOUR_PX = 52;

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
  const totalMins = (END_HOUR - START_HOUR) * 60;
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_PX;
  const hours = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h);

  if (loading) return <Spinner label="Loading schedule…" />;

  return (
    <div>
      <ErrorBanner message={error} />
      {hasConflicts && (
        <div className="mb-4 rounded-2xl border border-rose-300/50 bg-rose-50/70 px-4 py-2.5 text-sm font-medium text-rose-700">
          ⚠ Some classes have overlapping meeting times — those blocks are outlined in red.
        </div>
      )}

      {blocks.length === 0 ? (
        <EmptyHero
          illustration={<ScheduleIllustration />}
          headline="No meeting times yet"
          subheading="Add class meeting days and times to visualize your weekly schedule."
          ctaLabel="+ Add class times"
          onCta={() => navigate('/')}
        />
      ) : (
        <div className="glass-card overflow-x-auto p-4">
          {/* Desktop / wide: time-grid. Hidden on small screens. */}
          <div className="hidden min-w-[640px] sm:block">
            <div className="grid" style={{ gridTemplateColumns: '56px repeat(5, 1fr)' }}>
              <div />
              {DAYS.map((d) => (
                <div key={d} className="pb-2 text-center text-sm font-bold text-ink">{d}</div>
              ))}
            </div>
            <div className="grid" style={{ gridTemplateColumns: '56px repeat(5, 1fr)' }}>
              {/* Hour labels */}
              <div className="relative" style={{ height: gridHeight }}>
                {hours.map((h, i) => (
                  <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] font-semibold text-muted" style={{ top: i * HOUR_PX }}>
                    {fmtMinutes(h * 60)}
                  </div>
                ))}
              </div>
              {/* Day columns */}
              {DAYS.map((d, di) => (
                <div key={d} className="relative border-l border-white/40" style={{ height: gridHeight }}>
                  {hours.map((h, i) => (
                    <div key={h} className="absolute inset-x-0 border-t border-white/30" style={{ top: i * HOUR_PX }} />
                  ))}
                  {blocks
                    .filter((b) => b.day === di)
                    .map((b, k) => {
                      const top = ((b.start - START_HOUR * 60) / totalMins) * gridHeight;
                      const height = Math.max(22, ((b.end - b.start) / totalMins) * gridHeight);
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => navigate(`/classes/${b.cls.id}`)}
                          className={`absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-left text-white shadow-sm transition hover:brightness-105 ${b.conflict ? 'ring-2 ring-rose-500' : ''}`}
                          style={{ top, height, backgroundImage: b.gradient }}
                          title={`${b.cls.name} · ${fmtMinutes(b.start)}–${fmtMinutes(b.end)}${b.location ? ` · ${b.location}` : ''}`}
                        >
                          <div className="truncate text-[11px] font-bold leading-tight">{b.cls.name}</div>
                          <div className="truncate text-[9px] opacity-90">{fmtMinutes(b.start)}–{fmtMinutes(b.end)}</div>
                          {b.location && height > 40 && <div className="truncate text-[9px] opacity-80">{b.location}</div>}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>

          {/* Mobile: stack days vertically as lists. */}
          <div className="space-y-4 sm:hidden">
            {DAYS.map((d, di) => {
              const dayBlocks = blocks.filter((b) => b.day === di).sort((a, b) => a.start - b.start);
              return (
                <div key={d}>
                  <div className="mb-1.5 text-sm font-bold text-ink">{d}</div>
                  {dayBlocks.length === 0 ? (
                    <p className="text-xs text-muted">No classes</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dayBlocks.map((b, k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => navigate(`/classes/${b.cls.id}`)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-white ${b.conflict ? 'ring-2 ring-rose-500' : ''}`}
                          style={{ backgroundImage: b.gradient }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold">{b.cls.name}</div>
                            <div className="truncate text-[11px] opacity-90">
                              {fmtMinutes(b.start)}–{fmtMinutes(b.end)}{b.location ? ` · ${b.location}` : ''}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
