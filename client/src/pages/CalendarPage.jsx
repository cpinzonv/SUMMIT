import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { dueStatus, isDone } from '../lib/dueDate';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIEWS = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
  { key: 'year', label: 'Year' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };
const PRIORITY_DOT = {
  high: 'bg-rose-500',
  medium: 'bg-orange-400',
  low: 'bg-slate-400',
  none: 'bg-slate-300',
};
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };

// Dot color for a calendar event: a past-due (and not-done) DUE deadline turns
// red to stand out; otherwise the dot follows the assignment's priority.
function eventDot(ev) {
  if (ev.type === 'due' && !isDone(ev.a) && dueStatus(ev.a.dueDate).isPastDue) {
    return 'bg-rose-600 ring-1 ring-rose-300';
  }
  return PRIORITY_DOT[ev.a.priority || 'none'];
}

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

const toDateInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};
const dateInputToISO = (v) => new Date(`${v}T00:00:00`).toISOString();

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
  const [selected, setSelected] = useState(null); // details modal (single click)
  const [editing, setEditing] = useState(null); // edit modal (double click)
  const [toast, setToast] = useState(null);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    n.setHours(0, 0, 0, 0);
    return n;
  });

  // Drag-and-drop state.
  const draggedRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  const loadEvents = useCallback(async () => {
    try {
      const { data } = await api.get('/api/classes');
      const lists = await Promise.all(
        data.classes.map((c) =>
          api
            .get(`/api/classes/${c.id}/assignments`)
            .then((r) => ({ cls: c, assignments: r.data.assignments })),
        ),
      );
      const evs = [];
      lists.forEach(({ cls, assignments }, i) => {
        const gradient = classGradient(cls, i);
        assignments.forEach((a) => {
          if (a.dueDate)
            evs.push({ id: `${a.id}:due`, date: new Date(a.dueDate), type: 'due', a, cls, gradient });
          if (a.plannedDate)
            evs.push({ id: `${a.id}:planned`, date: new Date(a.plannedDate), type: 'planned', a, cls, gradient });
        });
      });
      setEvents(evs);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Single click → details; double click → edit. Debounce so a double click
  // doesn't briefly flash the details modal.
  const clickTimer = useRef(null);
  const act = {
    open: (ev) => {
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => setSelected(ev), 220);
    },
    edit: (ev) => {
      clearTimeout(clickTimer.current);
      setEditing(ev);
    },
  };

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

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
      if (view === 'year') return new Date(c.getFullYear() + dir, c.getMonth(), 1);
      if (view === 'month') return new Date(c.getFullYear(), c.getMonth() + dir, 1);
      return addDays(c, dir * (view === 'week' ? 7 : 1));
    });

  // Jump from the year grid into a specific month.
  const openMonth = (monthIndex) => {
    setCursor(new Date(cursor.getFullYear(), monthIndex, 1));
    setView('month');
  };

  // ---- Drag and drop: move an assignment's date to the dropped-on day -----
  async function moveEvent(ev, targetKey) {
    const field = ev.type === 'due' ? 'dueDate' : 'plannedDate';
    const [y, m, d] = targetKey.split('-').map(Number);
    const orig = ev.date;
    const newDate = new Date(y, m - 1, d, orig.getHours(), orig.getMinutes(), 0, 0);
    if (localKey(newDate) === localKey(orig)) return; // same day, no-op

    const prevDate = ev.date;
    const prevField = ev.a[field];
    const iso = newDate.toISOString();

    // Optimistic update.
    setEvents((es) =>
      es.map((e) => (e.id === ev.id ? { ...e, date: newDate, a: { ...e.a, [field]: iso } } : e)),
    );

    try {
      await api.patch(`/api/assignments/${ev.a.id}`, { [field]: iso });
      setToast({
        type: 'success',
        msg: `Moved “${ev.a.title}” to ${newDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      });
    } catch (err) {
      // Revert on failure.
      setEvents((es) =>
        es.map((e) =>
          e.id === ev.id ? { ...e, date: prevDate, a: { ...e.a, [field]: prevField } } : e,
        ),
      );
      setToast({ type: 'error', msg: errorMessage(err, 'Could not move assignment') });
    }
  }

  const dnd = {
    draggingId,
    dragOverKey,
    startDrag: (ev) => (e) => {
      if (ev.cls.archivedAt) return; // read-only / archived: not draggable
      draggedRef.current = ev;
      setDraggingId(ev.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ev.id);
    },
    endDrag: () => {
      draggedRef.current = null;
      setDraggingId(null);
      setDragOverKey(null);
    },
    overDate: (key) => (e) => {
      if (!draggedRef.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverKey !== key) setDragOverKey(key);
    },
    dropDate: (key) => (e) => {
      e.preventDefault();
      const ev = draggedRef.current;
      draggedRef.current = null;
      setDraggingId(null);
      setDragOverKey(null);
      if (ev) moveEvent(ev, key);
    },
  };

  const label = useMemo(() => {
    if (view === 'year') return String(cursor.getFullYear());
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
          <p className="mt-1 text-sm text-muted">
            All assignments across your classes — drag to reschedule
          </p>
        </div>
        <div className="flex items-center gap-3">
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
        <MonthView cursor={cursor} byDay={byDay} todayKey={todayKey} act={act} dnd={dnd} />
      ) : view === 'week' ? (
        <WeekView cursor={cursor} byDay={byDay} todayKey={todayKey} act={act} dnd={dnd} />
      ) : view === 'day' ? (
        <DayView cursor={cursor} byDay={byDay} act={act} />
      ) : (
        <YearView year={cursor.getFullYear()} byDay={byDay} todayKey={todayKey} onPickMonth={openMonth} />
      )}

      {selected && <EventModal ev={selected} onClose={() => setSelected(null)} />}
      {editing && (
        <AssignmentEditModal
          ev={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setToast({ type: 'success', msg });
            loadEvents();
          }}
        />
      )}
      {toast && <Toast toast={toast} />}
    </div>
  );
}

function Toast({ toast }) {
  const ok = toast.type === 'success';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={`glass-panel pointer-events-auto px-4 py-2.5 text-sm font-semibold shadow-lg ${
          ok ? 'text-emerald-600' : 'text-rose-600'
        }`}
      >
        {ok ? '✓ ' : '⚠ '}
        {toast.msg}
      </div>
    </div>
  );
}

function Dot({ p }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[p] || PRIORITY_DOT.none}`} />;
}

/* ---- Month ------------------------------------------------------------- */
/** Year view: a 3×4 grid of 12 mini-months; days with assignments show a dot
 *  colored by the highest-priority item that day. Click a month to zoom in. */
function YearView({ year, byDay, todayKey, onPickMonth }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {MONTH_NAMES.map((name, m) => (
        <MiniMonth
          key={m}
          year={year}
          month={m}
          name={name}
          byDay={byDay}
          todayKey={todayKey}
          onClick={() => onPickMonth(m)}
        />
      ))}
    </div>
  );
}

function topPriorityDot(events) {
  if (!events || events.length === 0) return null;
  let best = 'none';
  for (const ev of events) {
    const p = ev.a.priority || 'none';
    if (PRIORITY_RANK[p] > PRIORITY_RANK[best]) best = p;
  }
  return PRIORITY_DOT[best];
}

function MiniMonth({ year, month, name, byDay, todayKey, onClick }) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Open ${name} ${year}`}
      className="glass-card p-3 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-bold text-ink">{name}</span>
        <span className="text-[10px] font-semibold uppercase text-muted">{year}</span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="text-[9px] font-semibold text-muted">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (d == null) return <span key={i} />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const events = byDay.get(key);
          const dot = topPriorityDot(events);
          const isToday = key === todayKey;
          return (
            <span
              key={i}
              className={`relative grid h-5 place-items-center rounded text-[10px] ${
                isToday ? 'bg-brand-100 font-bold text-brand-700' : 'text-slate-600'
              }`}
            >
              {d}
              {dot && (
                <span
                  className={`absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${dot}`}
                  title={`${events.length} item${events.length === 1 ? '' : 's'}`}
                />
              )}
            </span>
          );
        })}
      </div>
    </button>
  );
}

function MonthView({ cursor, byDay, todayKey, act, dnd }) {
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
          const isOver = dnd.dragOverKey === key;
          return (
            <div
              key={i}
              onDragOver={dnd.overDate(key)}
              onDrop={dnd.dropDate(key)}
              className={`min-h-[96px] border-b border-r border-white/30 p-1.5 transition ${inMonth ? '' : 'bg-white/10'} ${isOver ? 'bg-brand-50/60 shadow-[inset_0_0_0_2px_rgba(63,161,166,0.6)]' : ''}`}
            >
              <div className={`mb-1 flex justify-end text-xs ${isToday ? 'font-extrabold' : inMonth ? 'text-slate-500' : 'text-slate-300'}`}>
                <span
                  className={isToday ? 'grid h-5 w-5 place-items-center rounded-full text-white' : ''}
                  style={isToday ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {evs.slice(0, 3).map((ev) => (
                  <MonthChip key={ev.id} ev={ev} act={act} dnd={dnd} />
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

function MonthChip({ ev, act, dnd }) {
  const isDue = ev.type === 'due';
  const draggable = !ev.cls.archivedAt;
  const isDragging = dnd.draggingId === ev.id;
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={dnd.startDrag(ev)}
      onDragEnd={dnd.endDrag}
      onClick={() => act.open(ev)}
      onDoubleClick={() => act.edit(ev)}
      title={`${ev.a.title} — ${ev.cls.name} (${isDue ? 'due' : 'planned'}, ${PRIORITY_LABEL[ev.a.priority || 'none']} priority) · double-click to edit`}
      className={`flex w-full items-center gap-1 truncate rounded-lg px-1.5 py-0.5 text-left text-[11px] font-semibold text-white shadow-sm transition hover:brightness-105 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40 ring-2 ring-white/70' : ''}`}
      style={{ backgroundImage: ev.gradient, opacity: isDragging ? 0.4 : isDue ? 1 : 0.42 }}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-white/70 ${eventDot(ev)}`} />
      <span className="truncate">{ev.a.title}</span>
    </button>
  );
}

/* ---- Week -------------------------------------------------------------- */
function WeekView({ cursor, byDay, todayKey, act, dnd }) {
  const ws = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  return (
    <div className="glass-card overflow-hidden">
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = localKey(d);
          const isToday = key === todayKey;
          const isOver = dnd.dragOverKey === key;
          const evs = sortEvents(byDay.get(key) || []);
          return (
            <div
              key={key}
              onDragOver={dnd.overDate(key)}
              onDrop={dnd.dropDate(key)}
              className={`min-h-[24rem] border-r border-white/30 transition last:border-r-0 ${isOver ? 'bg-brand-50/60 shadow-[inset_0_0_0_2px_rgba(63,161,166,0.6)]' : ''}`}
            >
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
                  evs.map((ev) => <EventRow key={ev.id} ev={ev} act={act} dnd={dnd} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventRow({ ev, act, dnd }) {
  const isDue = ev.type === 'due';
  const draggable = !ev.cls.archivedAt;
  const isDragging = dnd.draggingId === ev.id;
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={dnd.startDrag(ev)}
      onDragEnd={dnd.endDrag}
      onClick={() => act.open(ev)}
      onDoubleClick={() => act.edit(ev)}
      className={`flex w-full items-center gap-2 rounded-lg border border-white/50 bg-white/45 px-2 py-1.5 text-left transition hover:bg-white/75 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40 shadow-lg ring-2 ring-brand-400/50' : ''}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${eventDot(ev)}`} />
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
function DayView({ cursor, byDay, act }) {
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
      {evs.map((ev) => (
        <DayRow key={ev.id} ev={ev} act={act} />
      ))}
    </div>
  );
}

function DayRow({ ev, act }) {
  const isDue = ev.type === 'due';
  const p = ev.a.priority || 'none';
  return (
    <button
      type="button"
      onClick={() => act.open(ev)}
      onDoubleClick={() => act.edit(ev)}
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
        <DetailRow
          label="Due date"
          value={
            <span className="flex items-center gap-2">
              {fmtDateTime(a.dueDate)}
              {(() => {
                const st = dueStatus(a.dueDate);
                if (!st.hasDue || isDone(a)) return null;
                return (
                  <span className={`text-xs font-bold ${st.isPastDue ? 'text-rose-600' : 'text-muted'}`}>
                    ({st.isPastDue ? st.lateLabel : st.countdownLabel})
                  </span>
                );
              })()}
            </span>
          }
        />
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

/* ---- Quick edit (double-click) ----------------------------------------- */
function AssignmentEditModal({ ev, onClose, onSaved }) {
  const { a, cls } = ev;
  const [form, setForm] = useState({
    description: a.description || '',
    dueDate: toDateInput(a.dueDate),
    plannedDate: toDateInput(a.plannedDate),
    pointsEarned: a.grade?.pointsEarned ?? '',
    pointsPossible: a.grade?.pointsPossible ?? a.pointValue ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      // Patch the assignment fields. Send null to clear a previously-set date.
      await api.patch(`/api/assignments/${a.id}`, {
        description: form.description.trim() || null,
        dueDate: form.dueDate ? dateInputToISO(form.dueDate) : null,
        plannedDate: form.plannedDate ? dateInputToISO(form.plannedDate) : null,
      });
      // Optionally record/update a grade if a score was entered.
      if (form.pointsEarned !== '' && form.pointsEarned !== null) {
        const pointsEarned = Number(form.pointsEarned);
        const pointsPossible = form.pointsPossible === '' ? undefined : Number(form.pointsPossible);
        if (Number.isNaN(pointsEarned)) throw new Error('Grade must be a number');
        await api.post('/api/grades', {
          assignmentId: a.id,
          pointsEarned,
          ...(pointsPossible !== undefined ? { pointsPossible } : {}),
        });
      }
      onSaved(`Saved “${a.title}”`);
    } catch (e2) {
      setErr(errorMessage(e2, 'Could not save changes'));
      setSaving(false);
    }
  }

  return (
    <Modal title={a.title} onClose={onClose}>
      <form onSubmit={save} className="space-y-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundImage: ev.gradient }} />
          <span className="font-semibold text-ink">{cls.name}</span>
          {cls.code && <span className="text-muted">· {cls.code}</span>}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Description</span>
          <textarea
            value={form.description}
            onChange={set('description')}
            rows={3}
            placeholder="Add notes or details…"
            className="field"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Due date</span>
            <input type="date" value={form.dueDate} onChange={set('dueDate')} className="field" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Planned date</span>
            <input type="date" value={form.plannedDate} onChange={set('plannedDate')} className="field" />
          </label>
        </div>

        <div>
          <span className="mb-1 block text-xs font-semibold text-ink">Grade</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={form.pointsEarned}
              onChange={set('pointsEarned')}
              placeholder="Earned"
              className="field"
            />
            <span className="text-muted">/</span>
            <input
              type="number"
              min="0"
              step="any"
              value={form.pointsPossible}
              onChange={set('pointsPossible')}
              placeholder="Possible"
              className="field"
            />
          </div>
          <p className="mt-1 text-[11px] text-muted">Leave blank to skip grading.</p>
        </div>

        {err && <p className="text-xs font-semibold text-rose-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">
            Close
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
