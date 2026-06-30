import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, EmptyState, gradeColor } from './ui';

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

const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ClassAttendance({ classId }) {
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [date, setDate] = useState(todayInput());
  const [status, setStatus] = useState('present');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get(`/api/classes/${classId}/attendance`);
      setRecords(data.records);
      setSummary(data.summary);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const mark = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/classes/${classId}/attendance`, {
        sessionDate: date,
        status,
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (id) => {
    try {
      await api.delete(`/api/attendance/${id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (loading) return <Spinner label="Loading attendance…" />;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Summary + mark form */}
      <div className="space-y-4">
        <div className="glass-card relative overflow-hidden p-6 text-center">
          <span
            className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-50 blur-2xl"
            style={{ backgroundImage: 'var(--grad-teal-purple)' }}
          />
          <div className="relative text-xs font-medium uppercase tracking-wide text-muted">
            Attendance
          </div>
          <div className={`relative text-4xl font-extrabold ${gradeColor(summary?.rate)}`}>
            {summary?.rate != null ? `${summary.rate}%` : '—'}
          </div>
          <div className="relative mt-2 flex justify-center gap-3 text-xs text-muted">
            <span>{summary?.present ?? 0} present</span>
            <span>{summary?.late ?? 0} late</span>
            <span>{summary?.absent ?? 0} absent</span>
          </div>
        </div>

        <form onSubmit={mark} className="glass-card space-y-3 p-5">
          <h3 className="text-sm font-bold text-ink">Mark a session</h3>
          <ErrorBanner message={error} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          <div className="grid grid-cols-2 gap-2">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatus(s.key)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  status === s.key
                    ? `${BADGE[s.key]} ring-2 ring-brand-400/40`
                    : 'bg-white/50 text-muted hover:bg-white/80'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button type="submit" disabled={saving} className="btn btn-primary w-full">
            {saving ? 'Saving…' : 'Mark session'}
          </button>
        </form>
      </div>

      {/* Session log */}
      <div>
        {records.length === 0 ? (
          <EmptyState title="No sessions recorded">
            Mark your first session using the form.
          </EmptyState>
        ) : (
          <div className="glass-card divide-y divide-white/40 overflow-hidden">
            {records.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm font-medium text-ink">
                  {new Date(`${r.sessionDate}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-0.5 text-xs font-semibold capitalize ${BADGE[r.status]}`}>
                    {r.status}
                  </span>
                  <button
                    onClick={() => removeRecord(r.id)}
                    className="text-xs font-semibold text-muted transition hover:text-rose-500"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
