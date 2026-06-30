import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, EmptyState, gradeColor, Toggle } from './ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const STATUSES = [
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'absent', label: 'Absent' },
  { key: 'excused', label: 'Excused' },
];
const BADGE = {
  present: 'bg-emerald-100 text-emerald-700',
  late: 'bg-amber-100 text-amber-700',
  absent: 'bg-rose-100 text-rose-600',
  excused: 'bg-slate-200 text-slate-600',
};

function localSummary(sessions) {
  const c = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const s of sessions) if (s.status) c[s.status] += 1;
  const denom = c.present + c.late + c.absent;
  return {
    total: sessions.length,
    marked: c.present + c.late + c.absent + c.excused,
    ...c,
    rate: denom > 0 ? Math.round(((c.present + c.late) / denom) * 100) : null,
  };
}

const fmtSession = (date) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function ClassAttendance({ classId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError('');
      try {
        const { data } = await api.get(`/api/classes/${classId}/attendance`);
        setData(data);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [classId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (session, newStatus) => {
    const clearing = session.status === newStatus;
    // Optimistic update.
    setData((d) => {
      const sessions = d.sessions.map((s) =>
        s.sessionDate === session.sessionDate
          ? { ...s, status: clearing ? null : newStatus }
          : s,
      );
      return { ...d, sessions, summary: localSummary(sessions) };
    });
    try {
      if (clearing && session.recordId) {
        await api.delete(`/api/attendance/${session.recordId}`);
      } else {
        await api.post(`/api/classes/${classId}/attendance`, {
          sessionDate: session.sessionDate,
          status: newStatus,
        });
      }
      await load(false); // sync real record ids
    } catch (err) {
      setError(errorMessage(err));
      await load(false);
    }
  };

  if (loading) return <Spinner label="Loading attendance…" />;
  if (!data) return <ErrorBanner message={error} />;

  const { sessions, summary, schedule } = data;

  if (!schedule.configured || editing) {
    return (
      <ScheduleForm
        classId={classId}
        schedule={schedule}
        onSaved={async () => {
          setEditing(false);
          await load();
        }}
        onCancel={schedule.configured ? () => setEditing(false) : null}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Summary */}
      <div className="space-y-4">
        <div className="glass-card relative overflow-hidden p-6 text-center">
          <span
            className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-50 blur-2xl"
            style={{ backgroundImage: 'var(--grad-teal-purple)' }}
          />
          <div className="relative text-xs font-medium uppercase tracking-wide text-muted">
            Attendance
          </div>
          <div className={`relative text-4xl font-extrabold ${gradeColor(summary.rate)}`}>
            {summary.rate != null ? `${summary.rate}%` : '—'}
          </div>
          <div className="relative mt-1 text-xs text-muted">
            {summary.marked} of {summary.total} sessions marked
          </div>
          <div className="relative mt-3 flex justify-center gap-3 text-xs text-muted">
            <span>{summary.present} present</span>
            <span>{summary.late} late</span>
            <span>{summary.absent} absent</span>
          </div>
          {schedule.attendanceGraded && schedule.attendanceWeight != null && (
            <div className="relative mt-3 rounded-full bg-brand-50/80 px-3 py-1 text-xs font-semibold text-brand-700">
              Worth {schedule.attendanceWeight}% of your grade
            </div>
          )}
        </div>
        <div className="glass-card p-4 text-sm">
          <div className="font-bold text-ink">Schedule</div>
          <div className="mt-1 text-muted">
            {schedule.meetingDays.join(', ')}
            {schedule.meetingTime ? ` · ${schedule.meetingTime}` : ''}
          </div>
          <button onClick={() => setEditing(true)} className="mt-3 btn btn-soft w-full">
            Edit schedule
          </button>
        </div>
      </div>

      {/* Session list */}
      <div>
        <ErrorBanner message={error} />
        {sessions.length === 0 ? (
          <EmptyState title="No sessions in this date range" />
        ) : (
          <div className="glass-card divide-y divide-white/40 overflow-hidden">
            {sessions.map((s) => (
              <div
                key={s.sessionDate}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <span className="text-sm font-medium text-ink">{fmtSession(s.sessionDate)}</span>
                <div className="flex gap-1.5">
                  {STATUSES.map((st) => {
                    const active = s.status === st.key;
                    return (
                      <button
                        key={st.key}
                        onClick={() => setStatus(s, st.key)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          active
                            ? `${BADGE[st.key]} ring-2 ring-brand-400/40`
                            : 'bg-white/45 text-muted hover:bg-white/80'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleForm({ classId, schedule, onSaved, onCancel }) {
  const [startDate, setStartDate] = useState(schedule.startDate || '');
  const [endDate, setEndDate] = useState(schedule.endDate || '');
  const [days, setDays] = useState(schedule.meetingDays || []);
  const [time, setTime] = useState(schedule.meetingTime || '');
  const [graded, setGraded] = useState(Boolean(schedule.attendanceGraded));
  const [weight, setWeight] = useState(
    schedule.attendanceWeight != null ? String(schedule.attendanceWeight) : '',
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleDay = (d) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const save = async (e) => {
    e.preventDefault();
    if (!startDate || !endDate || days.length === 0) {
      setError('Pick a start date, end date, and at least one meeting day.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/classes/${classId}`, {
        startDate,
        endDate,
        meetingDays: days,
        meetingTime: time || null,
        attendanceGraded: graded,
        attendanceWeight: graded && weight !== '' ? Number(weight) : null,
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="glass-card mx-auto max-w-lg space-y-4 p-6">
      <div>
        <h3 className="text-lg font-bold text-ink">Set up the class schedule</h3>
        <p className="text-sm text-muted">
          Sessions are generated automatically for every meeting day in the term.
        </p>
      </div>
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Start date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">End date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="field" />
        </label>
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink">Meeting days</span>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  on
                    ? 'text-white shadow-sm'
                    : 'bg-white/55 text-muted hover:bg-white/80'
                }`}
                style={on ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
      <label className="block max-w-[12rem]">
        <span className="mb-1 block text-sm font-semibold text-ink">Time (optional)</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field" />
      </label>

      <div className="rounded-2xl border border-white/60 bg-white/40 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm font-semibold text-ink">Attendance is graded</span>
            <p className="text-xs text-muted">Count attendance toward the final class grade.</p>
          </div>
          <Toggle on={graded} onChange={() => setGraded((v) => !v)} />
        </div>
        {graded && (
          <label className="mt-3 block max-w-[14rem]">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Attendance grade weight (%)
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="10"
              className="field"
            />
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-soft">
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </form>
  );
}
