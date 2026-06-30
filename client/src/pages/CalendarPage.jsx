import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  classGradient,
  Modal,
  gradeColor,
} from '../components/ui';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIEWS = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
];

const PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };
const PRIORITY_DOT = {
  high: 'bg-rose-500',
  medium: 'bg-orange-400',
  low: 'bg-slate-400',
  none: 'bg-slate-300',
};
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };

const localKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d) => addDays(d, -d.getDay());

// Sort by priority (High → Medium → Low → None), then by date ascending.
function sortEvents(evs) {
  return [...evs].sort((a, b) => {
    const pr = PRIORITY_RANK[b.a.priority || 'none'] - PRIORITY_RANK[a.a.priority || 'none'];
    return pr !== 0 ? pr : a.date - b.date;
  });
}

export default function CalendarPage() {
  const { preferences } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => preferences.defaultCalendarView || 'month');
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    n.setHours(0, 0, 0, 0);
    return n;
  });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/api/classes');
        const lists = await Promise.all(
          data.classes.map((c) =>
            api
              .get(`/api/classes/${c.id}/assignments`)
              .then((r) => ({ cls: c, assignments: r.data.assignments })),
          ),
        );
        if (!active) return;
        const evs = [];
        lists.forEach(({ cls, assignments }, i) => {
          const gradient = classGradient(cls, i);
          assignments.forEach((a) => {
            if (a.dueDate)
              evs.push({ date: new Date(a.dueDate), type: 'due', a, cls, gradient });
            if (a.plannedDate)
              evs.push({ date: new Date(a.plannedDate), type: 'planned', a, cls, gradient });
          });
        });
        setEvents(evs);
      } catch (err) {
        if (active) setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const key = localKey(ev.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return map;
  }, [events]);

  const todayKey = localKey(new Date());

  const shift = (dir) =>
    setCursor((c) => {
      if (view === 'month') return new Date(c.getFullYear(), c.getMonth() + dir, 1);
      return addDays(c, dir * (view === 'week' ? 7 : 1));
    });

  const label = useMemo(() => {
    if (view === 'month')
      return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (view === 'week') {
      const ws = startOfWeek(cursor);
      const we = addDays(ws, 6);
      return `${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return cursor.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [view, cursor]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted">All assignments across your classes</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex gap-1 rounded-full bg-white/45 p-1 backdrop-blur">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                  view === v.key ? 'bg-white/80 text-brand-700 shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="btn btn-soft !px-3 !py-1.5">←</button>
            <span className="min-w-[170px] text-center text-sm font-bold">{label}</span>
            <button onClick={() => shift(1)} className="btn btn-soft !px-3 !py-1.5">→</button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-4 text-xs font-medium text-muted">
        <span className="flex items-center gap-1.5"><Dot p="high" /> High</span>
        <span className="flex items-center gap-1.5"><Dot p="medium" /> Medium</span>
        <span className="flex items-center gap-1.5"><Dot p="low" /> Low / None</span>
        <span className="ml-2 flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-md" style={{ backgroundImage: 'var(--grad-teal-purple)' }} /> Due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-md opacity-40" style={{ backgroundImage: 'var(--grad-teal-purple)' }} /> Planned
        </span>
      </div>

      {loading ? (
        <Spinner label="Loading calendar…" />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : view === 'month' ? (
        <MonthView cursor={cursor} byDay={byDay} todayKey={todayKey} onSelect={setSelected} />
      ) : view === 'week' ? (
        <WeekView cursor={cursor} byDay={byDay} todayKey={todayKey} onSelect={setSelected} />
      ) : (
        <DayView cursor={cursor} byDay={byDay} onSelect={setSelected} />
      )}

      {selected && <EventModal ev={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Dot({ p }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[p] || PRIORITY_DOT.none}`} />;
}

/* ---- Month ------------------------------------------------------------- */
function MonthView({ cursor, byDay, todayKey, onSelect }) {
  const cells = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  return (
    <div className="glass-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-white/50 text-center text-xs font-semibold text-muted">
        {DOW.map((d) => (
          <div key={d} className="py-3">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const key = localKey(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const evs = sortEvents(byDay.get(key) || []);
          const isToday = key === todayKey;
          return (
            <div key={i} className={`min-h-[96px] border-b border-r border-white/30 p-1.5 ${inMonth ? '' : 'bg-white/10'}`}>
              <div className={`mb-1 flex justify-end text-xs ${isToday ? 'font-extrabold' : inMonth ? 'text-slate-500' : 'text-slate-300'}`}>
                <span
                  className={isToday ? 'grid h-5 w-5 place-items-center rounded-full text-white' : ''}
                  style={isToday ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {evs.slice(0, 3).map((ev, j) => (
                  <MonthChip key={j} ev={ev} onSelect={onSelect} />
                ))}
                {evs.length > 3 && <div className="text-[10px] text-muted">+{evs.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthChip({ ev, onSelect }) {
  const isDue = ev.type === 'due';
  return (
    <button
      type="button"
      onClick={() => onSelect(ev)}
      title={`${ev.a.title} — ${ev.cls.name} (${isDue ? 'due' : 'planned'}, ${PRIORITY_LABEL[ev.a.priority || 'none']} priority)`}
      className="flex w-full items-center gap-1 truncate rounded-lg px-1.5 py-0.5 text-left text-[11px] font-semibold text-white shadow-sm transition hover:brightness-105"
      style={{ backgroundImage: ev.gradient, opacity: isDue ? 1 : 0.42 }}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-white/70 ${PRIORITY_DOT[ev.a.priority || 'none']}`} />
      <span className="truncate">{ev.a.title}</span>
    </button>
  );
}

/* ---- Week -------------------------------------------------------------- */
function WeekView({ cursor, byDay, todayKey, onSelect }) {
  const ws = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  return (
    <div className="glass-card overflow-hidden">
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = localKey(d);
          const isToday = key === todayKey;
          const evs = sortEvents(byDay.get(key) || []);
          return (
            <div key={key} className="min-h-[24rem] border-r border-white/30 last:border-r-0">
              <div className="border-b border-white/40 px-2 py-2 text-center">
                <div className="text-[11px] font-medium text-muted">{DOW[d.getDay()]}</div>
                <div
                  className={`mx-auto mt-0.5 text-sm font-bold ${isToday ? 'grid h-6 w-6 place-items-center rounded-full text-white' : 'text-ink'}`}
                  style={isToday ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                >
                  {d.getDate()}
                </div>
              </div>
              <div className="space-y-1 p-1.5">
                {evs.length === 0 ? (
                  <p className="px-1 py-2 text-center text-[10px] text-muted/60">—</p>
                ) : (
                  evs.map((ev, i) => <EventRow key={i} ev={ev} onSelect={onSelect} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventRow({ ev, onSelect }) {
  const isDue = ev.type === 'due';
  return (
    <button
      type="button"
      onClick={() => onSelect(ev)}
      className="flex w-full items-center gap-2 rounded-lg border border-white/50 bg-white/45 px-2 py-1.5 text-left transition hover:bg-white/75"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[ev.a.priority || 'none']}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">{ev.a.title}</span>
        <span className="block truncate text-[10px] text-muted">{ev.cls.code || ev.cls.name}</span>
      </span>
      <span className={`shrink-0 text-[9px] font-semibold uppercase ${isDue ? 'text-brand-600' : 'text-muted'}`}>
        {isDue ? 'due' : 'plan'}
      </span>
    </button>
  );
}

/* ---- Day --------------------------------------------------------------- */
function DayView({ cursor, byDay, onSelect }) {
  const evs = sortEvents(byDay.get(localKey(cursor)) || []);
  if (evs.length === 0) {
    return (
      <EmptyState title="Nothing scheduled">
        No assignments due or planned on this day.
      </EmptyState>
    );
  }
  return (
    <div className="glass-card space-y-2 p-4">
      {evs.map((ev, i) => (
        <DayRow key={i} ev={ev} onSelect={onSelect} />
      ))}
    </div>
  );
}

function DayRow({ ev, onSelect }) {
  const isDue = ev.type === 'due';
  const p = ev.a.priority || 'none';
  return (
    <button
      type="button"
      onClick={() => onSelect(ev)}
      className="flex w-full items-center gap-3 rounded-xl border border-white/50 bg-white/45 px-4 py-3 text-left transition hover:bg-white/75"
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_DOT[p]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-ink">{ev.a.title}</span>
          {p !== 'none' && (
            <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">
              {PRIORITY_LABEL[p]}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted">
          {ev.cls.name}
          {ev.cls.code ? ` · ${ev.cls.code}` : ''}
        </div>
      </div>
      <span className={`shrink-0 text-xs font-semibold ${isDue ? 'text-brand-600' : 'text-muted'}`}>
        {isDue ? 'Due' : 'Planned'}
      </span>
    </button>
  );
}

/* ---- Shared modal ------------------------------------------------------ */
function fmtDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function EventModal({ ev, onClose }) {
  const { a, cls } = ev;
  const p = a.priority || 'none';
  return (
    <Modal title={a.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundImage: ev.gradient }} />
          <span className="font-semibold text-ink">{cls.name}</span>
          {cls.code && <span className="text-muted">· {cls.code}</span>}
        </div>

        <DetailRow
          label="Priority"
          value={
            <span className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[p]}`} />
              {PRIORITY_LABEL[p]}
            </span>
          }
        />
        <DetailRow label="Category" value={a.category || '—'} />
        <DetailRow label="Status" value={a.status?.replace('_', ' ')} />
        <DetailRow label="Due date" value={fmtDateTime(a.dueDate)} />
        <DetailRow label="Planned date" value={fmtDateTime(a.plannedDate)} />
        <DetailRow label="Point value" value={a.pointValue ?? '—'} />
        <DetailRow
          label="Grade"
          value={
            a.grade ? (
              <span className={gradeColor((a.grade.pointsEarned / a.grade.pointsPossible) * 100)}>
                {a.grade.pointsEarned}/{a.grade.pointsPossible}
              </span>
            ) : (
              'Not graded'
            )
          }
        />

        <Link to={`/classes/${cls.id}`} className="btn btn-primary mt-2 w-full">
          Open class
        </Link>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between border-b border-white/50 pb-2">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}
