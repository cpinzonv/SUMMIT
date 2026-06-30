import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, classGradient, Modal, gradeColor } from '../components/ui';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const localKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/api/classes');
        const classes = data.classes;
        const lists = await Promise.all(
          classes.map((c) =>
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
              evs.push({
                date: new Date(a.plannedDate),
                type: 'planned',
                a,
                cls,
                gradient,
              });
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

  const cells = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const todayKey = localKey(new Date());

  const shiftMonth = (delta) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted">
            All assignments across your classes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="btn btn-soft !px-3 !py-1.5">←</button>
          <span className="min-w-[150px] text-center text-sm font-bold">{monthLabel}</span>
          <button onClick={() => shiftMonth(1)} className="btn btn-soft !px-3 !py-1.5">→</button>
        </div>
      </div>

      <div className="mb-4 flex gap-5 text-xs font-medium text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-md" style={{ backgroundImage: 'var(--grad-teal-purple)' }} /> Due date
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-md opacity-40" style={{ backgroundImage: 'var(--grad-teal-purple)' }} /> Planned date
        </span>
      </div>

      {loading ? (
        <Spinner label="Loading calendar…" />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
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
              const dayEvents = byDay.get(key) || [];
              const isToday = key === todayKey;
              return (
                <div
                  key={i}
                  className={`min-h-[96px] border-b border-r border-white/30 p-1.5 ${
                    inMonth ? '' : 'bg-white/10'
                  }`}
                >
                  <div
                    className={`mb-1 flex justify-end text-xs ${
                      isToday
                        ? 'font-extrabold text-brand-600'
                        : inMonth
                          ? 'text-slate-500'
                          : 'text-slate-300'
                    }`}
                  >
                    <span
                      className={
                        isToday
                          ? 'grid h-5 w-5 place-items-center rounded-full text-white'
                          : ''
                      }
                      style={isToday ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                    >
                      {d.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((ev, j) => (
                      <EventChip key={j} ev={ev} onSelect={setSelected} />
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-muted">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && <EventModal ev={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EventChip({ ev, onSelect }) {
  const isDue = ev.type === 'due';
  return (
    <button
      type="button"
      onClick={() => onSelect(ev)}
      title={`${ev.a.title} — ${ev.cls.name} (${isDue ? 'due' : 'planned'})`}
      className="block w-full truncate rounded-lg px-1.5 py-0.5 text-left text-[11px] font-semibold text-white shadow-sm transition hover:brightness-105"
      style={{ backgroundImage: ev.gradient, opacity: isDue ? 1 : 0.42 }}
    >
      {ev.a.title}
    </button>
  );
}

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
  return (
    <Modal title={a.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundImage: ev.gradient }} />
          <span className="font-semibold text-ink">{cls.name}</span>
          {cls.code && <span className="text-muted">· {cls.code}</span>}
        </div>

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
