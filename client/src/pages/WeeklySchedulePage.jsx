import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, classGradient, classAccent, isGlassColor } from '../components/ui';
import { generateClassSessions, normalizedMeetings } from '../lib/classMeetings';
import { dayLoads, hoursLabel } from '../lib/scheduleLoad';

/**
 * Schedule — the student's ACTUAL current weekly schedule, derived automatically
 * from their active classes' meeting times. Distinct from the Planner (which is
 * for planning FUTURE, hypothetical semesters). Read-only at this stage: a week
 * grid of fixed class blocks, no dragging and no new data.
 *
 * Every block comes from the shared meeting-times model via generateClassSessions
 * (lib/classMeetings) — the same source the To-Do calendar uses — so the two can
 * never disagree, and each class's semester start/end dates are already honoured.
 */

// Mon–Sun columns. JS getDay(): Sun=0 … Sat=6; (getDay()+6)%7 → Mon=0 … Sun=6.
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_START_MIN = 7 * 60; // 7:00
const DEFAULT_END_MIN = 22 * 60; // 22:00
const PX_PER_MIN = 0.8; // vertical scale of the grid

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
// Monday that starts the week containing `d`.
const startOfWeekMon = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
};

const fmtHour = (min) => {
  const h = Math.floor(min / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12} ${ap}`;
};
const fmt12 = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${pad(m)}${ap}` : `${h12}${ap}`;
};
const timeLabel = (s) => (s.end ? `${fmt12(s.start)}–${fmt12(s.end)}` : fmt12(s.start));

// Assign overlapping same-day sessions to side-by-side lanes so blocks never
// cover each other. Lanes are computed per overlap cluster, so a lone overlap
// doesn't shrink the rest of the day. Returns each session with { lane, lanes }.
function packDay(sessions) {
  const items = sessions
    .map((s) => ({ s, startMin: s.startMin ?? 0, endMin: s.endMin ?? (s.startMin ?? 0) + 60 }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const laneEnds = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => end <= it.startMin);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMin); }
      else laneEnds[lane] = it.endMin;
      it.lane = lane;
    }
    for (const it of cluster) out.push({ ...it, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

export default function WeeklySchedulePage() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cards, setCards] = useState([]); // To-Do feed (assignments + tasks) for workload chips
  // The visible week is identified by the Monday it starts on.
  const [weekStart, setWeekStart] = useState(() => startOfWeekMon(new Date()));
  const [popoverDay, setPopoverDay] = useState(null); // { key, x, y } for the open day's load list

  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/api/classes'), api.get('/api/todo')])
      .then(([clsRes, todoRes]) => {
        if (!alive) return;
        setClasses(clsRes.data.classes || []);
        setCards(todoRes.data.cards || []);
      })
      .catch((err) => { if (alive) setError(errorMessage(err, 'Could not load your schedule.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Active = not archived (same definition the Dashboard/calendar use).
  const activeClasses = useMemo(() => classes.filter((c) => !c.archivedAt), [classes]);
  const hasAnyMeetings = useMemo(
    () => activeClasses.some((c) => normalizedMeetings(c).length > 0),
    [activeClasses],
  );

  // Per-day estimated workload (assignments only, done excluded, active classes),
  // keyed by 'YYYY-MM-DD'. Effective day = scheduled_time ?? planned_date ?? due_date.
  const loads = useMemo(() => {
    const activeClassIds = new Set(activeClasses.map((c) => c.id));
    return dayLoads(cards, { activeClassIds });
  }, [cards, activeClasses]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // Expand every active class's recurrence into this week's concrete sessions,
  // grouped by day key. Colours are resolved once per class.
  const byDay = useMemo(() => {
    const from = dateKey(days[0]);
    const to = dateKey(days[6]);
    const map = new Map(days.map((d) => [dateKey(d), []]));
    activeClasses.forEach((cls, i) => {
      const gradient = classGradient(cls, i);
      const glass = isGlassColor(cls.color);
      for (const session of generateClassSessions(cls, { from, to })) {
        const bucket = map.get(session.date);
        if (bucket) bucket.push({ ...session, gradient, glass });
      }
    });
    return map;
  }, [activeClasses, days]);

  // Fit the visible range to the sessions, but never smaller than 7:00–22:00.
  const [startMin, endMin] = useMemo(() => {
    let lo = DEFAULT_START_MIN;
    let hi = DEFAULT_END_MIN;
    for (const list of byDay.values()) {
      for (const s of list) {
        if (s.startMin != null) lo = Math.min(lo, s.startMin);
        const e = s.endMin ?? (s.startMin != null ? s.startMin + 60 : null);
        if (e != null) hi = Math.max(hi, e);
      }
    }
    return [Math.floor(lo / 60) * 60, Math.ceil(hi / 60) * 60];
  }, [byDay]);

  const gridHeight = (endMin - startMin) * PX_PER_MIN;
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  const todayKey = dateKey(new Date());
  const monthLabel = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const rangeLabel = `${monthLabel(days[0])} – ${monthLabel(days[6])}, ${days[6].getFullYear()}`;

  const goToday = () => setWeekStart(startOfWeekMon(new Date()));
  const goPrev = () => setWeekStart((w) => addDays(w, -7));
  const goNext = () => setWeekStart((w) => addDays(w, 7));

  if (loading) return <Spinner label="Loading your schedule…" />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-muted">
            Your week, built from your classes&rsquo; meeting times.
          </p>
        </div>
        {hasAnyMeetings && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={goToday} className="btn btn-soft !py-1.5">Today</button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={goPrev} aria-label="Previous week" className="btn btn-soft !px-3 !py-1.5">←</button>
              <span className="min-w-[150px] text-center text-sm font-bold text-ink">{rangeLabel}</span>
              <button type="button" onClick={goNext} aria-label="Next week" className="btn btn-soft !px-3 !py-1.5">→</button>
            </div>
          </div>
        )}
      </div>

      <ErrorBanner message={error} />

      {!hasAnyMeetings ? (
        <EmptyStateCard />
      ) : (
        <div className="glass-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              {/* Day header row (time-axis gutter + 7 days). */}
              <div
                className="grid border-b border-white/40"
                style={{ gridTemplateColumns: '3.5rem repeat(7, minmax(0, 1fr))' }}
              >
                <div />
                {days.map((d) => {
                  const key = dateKey(d);
                  const isToday = key === todayKey;
                  const load = loads.get(key);
                  const openLoad = (e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPopoverDay((cur) => (cur?.key === key ? null : { key, x: r.left + r.width / 2, y: r.bottom + 6 }));
                  };
                  return (
                    <div key={key} className="border-l border-white/30 px-2 py-2 text-center">
                      <div className="text-[11px] font-medium text-muted">{DOW[(d.getDay() + 6) % 7]}</div>
                      <div
                        className={`mx-auto mt-0.5 grid h-6 w-6 place-items-center text-sm font-bold ${
                          isToday ? 'rounded-full text-white' : 'text-ink'
                        }`}
                        style={isToday ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                      >
                        {d.getDate()}
                      </div>
                      {/* Per-day estimated workload chip (omitted when 0). */}
                      {load && load.hours > 0 && (
                        <button
                          type="button"
                          onClick={openLoad}
                          title={`${hoursLabel(load.hours)} of estimated work`}
                          aria-label={`${hoursLabel(load.hours)} of estimated work on ${DOW[(d.getDay() + 6) % 7]}`}
                          className={`mx-auto mt-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold transition ${
                            popoverDay?.key === key
                              ? 'border-transparent text-white shadow-sm'
                              : 'border-white/50 bg-white/50 text-brand-700 hover:bg-white/75'
                          }`}
                          style={popoverDay?.key === key ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                        >
                          {hoursLabel(load.hours)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Time axis + day columns. */}
              <div
                className="grid"
                style={{ gridTemplateColumns: '3.5rem repeat(7, minmax(0, 1fr))', height: `${gridHeight}px` }}
              >
                {/* Time axis */}
                <div className="relative">
                  {hours.map((m) => (
                    <div
                      key={m}
                      className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium text-muted"
                      style={{ top: `${(m - startMin) * PX_PER_MIN}px` }}
                    >
                      {m < endMin ? fmtHour(m) : ''}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {days.map((d) => {
                  const sessions = packDay(byDay.get(dateKey(d)) || []);
                  const isToday = dateKey(d) === todayKey;
                  return (
                    <div
                      key={dateKey(d)}
                      className={`relative border-l border-white/30 ${isToday ? 'bg-brand-50/40' : ''}`}
                    >
                      {/* Hour gridlines */}
                      {hours.map((m) => (
                        <div
                          key={m}
                          className="absolute inset-x-0 border-t border-white/25"
                          style={{ top: `${(m - startMin) * PX_PER_MIN}px` }}
                        />
                      ))}
                      {/* Class blocks */}
                      {sessions.map(({ s, lane, lanes }) => {
                        const top = ((s.startMin ?? startMin) - startMin) * PX_PER_MIN;
                        const rawH = ((s.endMin ?? (s.startMin ?? 0) + 60) - (s.startMin ?? 0)) * PX_PER_MIN;
                        const height = Math.max(rawH, 26);
                        const widthPct = 100 / lanes;
                        return (
                          <div
                            key={`${s.cls.id}:${s.start}:${lane}`}
                            title={`${s.cls.name} · ${timeLabel(s)}${s.location ? ` · ${s.location}` : ''}`}
                            className={`absolute overflow-hidden rounded-lg border px-1.5 py-1 text-[11px] leading-tight ${
                              s.glass
                                ? 'border-white/60 bg-white/70 text-ink backdrop-blur'
                                : 'border-white/40 text-white'
                            }`}
                            style={{
                              top: `${top}px`,
                              height: `${height - 2}px`,
                              left: `calc(${lane * widthPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              ...(s.glass ? {} : { backgroundImage: s.gradient }),
                            }}
                          >
                            <div className="truncate font-bold">{s.cls.name}</div>
                            <div className={`truncate ${s.glass ? 'text-muted' : 'text-white/85'}`}>{timeLabel(s)}</div>
                            {s.location && (
                              <div className={`truncate ${s.glass ? 'text-muted' : 'text-white/75'}`}>{s.location}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {popoverDay && loads.get(popoverDay.key) && (
        <LoadPopover anchor={popoverDay} load={loads.get(popoverDay.key)} onClose={() => setPopoverDay(null)} />
      )}
    </div>
  );
}

/** Read-only list of a day's estimated work: class color dot + title + hours.
 *  Fixed-positioned near the clicked chip so the grid's overflow can't clip it. */
function LoadPopover({ anchor, load, onClose }) {
  const [y, m, d] = anchor.key.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <>
      {/* Click-away backdrop. */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={`Estimated work for ${label}`}
        className="glass-card fixed z-50 w-64 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 p-3.5"
        style={{ top: `${anchor.y}px`, left: `${Math.min(Math.max(anchor.x, 140), window.innerWidth - 140)}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-ink">{label}</span>
          <span className="text-xs font-semibold text-brand-600">{hoursLabel(load.hours)}</span>
        </div>
        <ul className="space-y-1.5">
          {load.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundImage: classAccent({ color: item.color }) }}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.title}</span>
              <span className="shrink-0 text-xs font-medium text-muted">{hoursLabel(item.estimatedHours)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 border-t border-white/40 pt-2 text-[11px] text-muted">Time-blocking coming soon.</p>
      </div>
    </>
  );
}

function EmptyStateCard() {
  return (
    <div className="glass-card mx-auto max-w-lg p-8 text-center">
      <div
        className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl"
        style={{ backgroundImage: 'var(--grad-teal-purple)', opacity: 0.9 }}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3.8" y="5.4" width="16.4" height="14" rx="3" />
          <path d="M3.8 9.6h16.4" />
          <path d="M8.4 3.6v3.4" />
          <path d="M15.6 3.6v3.4" />
        </svg>
      </div>
      <h2 className="font-display text-lg font-bold text-ink">Your schedule builds itself</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Add meeting times to your classes and they&rsquo;ll appear here.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex items-center rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105"
        style={{ backgroundImage: 'var(--grad-teal-purple)' }}
      >
        Go to your classes
      </Link>
    </div>
  );
}
