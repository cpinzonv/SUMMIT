import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, classColor, Modal, gradeColor } from '../components/ui';

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
          const color = classColor(cls, i);
          assignments.forEach((a) => {
            if (a.dueDate)
              evs.push({ date: new Date(a.dueDate), type: 'due', a, cls, color });
            if (a.plannedDate)
              evs.push({
                date: new Date(a.plannedDate),
                type: 'planned',
                a,
                cls,
                color,
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

  // Group events by local date key for quick lookup.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const key = localKey(ev.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return map;
  }, [events]);

  // Build a 6-week grid starting on the Sunday on/before the 1st.
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Calendar</h1>
          <p className="text-sm text-slate-500">
            All assignments across your classes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">←</button>
          <span className="min-w-[150px] text-center text-sm font-medium">{monthLabel}</span>
          <button onClick={() => shiftMonth(1)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">→</button>
        </div>
      </div>

      <div className="mb-4 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-brand-600" /> Due date
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-brand-600 opacity-40" /> Planned date
        </span>
      </div>

      {loading ? (
        <Spinner label="Loading calendar…" />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium text-slate-500">
            {DOW.map((d) => (
              <div key={d} className="py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const key = localKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const dayEvents = byDay.get(key) || [];
              return (
                <div
                  key={i}
                  className={`min-h-[92px] border-b border-r border-slate-100 p-1.5 ${
                    inMonth ? 'bg-white' : 'bg-slate-50/60'
                  }`}
                >
                  <div
                    className={`mb-1 text-right text-xs ${
                      key === todayKey
                        ? 'font-bold text-brand-600'
                        : inMonth
                          ? 'text-slate-500'
                          : 'text-slate-300'
                    }`}
                  >
                    {d.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((ev, j) => (
                      <EventChip key={j} ev={ev} onSelect={setSelected} />
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-slate-400">
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

      {selected && (
        <EventModal ev={selected} onClose={() => setSelected(null)} />
      )}
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
      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
      style={{
        backgroundColor: ev.color,
        opacity: isDue ? 1 : 0.4,
      }}
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
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: ev.color }}
          />
          <span className="font-medium text-slate-700">{cls.name}</span>
          {cls.code && <span className="text-slate-400">· {cls.code}</span>}
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

        <Link
          to={`/classes/${cls.id}`}
          className="mt-2 block rounded-lg bg-brand-600 py-2 text-center font-medium text-white hover:bg-brand-700"
        >
          Open class
        </Link>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}
