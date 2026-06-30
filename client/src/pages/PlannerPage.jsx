import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  Modal,
  classGradient,
} from '../components/ui';

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
const STATUS_BADGE = {
  planned: 'bg-slate-200 text-slate-600',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
};
const GRAD_GOAL = 120; // typical bachelor's credit requirement

export default function PlannerPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/api/plan');
      setItems(data.items);
      setSummary(data.summary);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Group items into terms, preserving the server's chronological order.
  const terms = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.term)) map.set(it.term, []);
      map.get(it.term).push(it);
    }
    return [...map.entries()].map(([term, courses]) => ({
      term,
      courses,
      credits: courses.reduce((t, c) => t + (c.credits || 0), 0),
    }));
  }, [items]);

  const setStatus = async (item, status) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
    try {
      await api.patch(`/api/plan/${item.id}`, { status });
      await load();
    } catch (err) {
      setError(errorMessage(err));
      await load();
    }
  };

  const remove = async (item) => {
    try {
      await api.delete(`/api/plan/${item.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const completed = summary?.completedCredits ?? 0;
  const pct = Math.min(100, Math.round((completed / GRAD_GOAL) * 100));

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Academic plan</h1>
          <p className="mt-1 text-sm text-muted">
            Map your path to graduation, semester by semester
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn btn-primary">
          + Add course
        </button>
      </div>

      {/* Roadmap-to-graduation progress */}
      <div className="glass-card relative mb-8 overflow-hidden p-6">
        <span
          className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-50 blur-2xl"
          style={{ backgroundImage: 'var(--grad-teal-purple)' }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Progress to graduation
            </div>
            <div className="mt-1 text-3xl font-extrabold">
              <span className="text-gradient">{completed}</span>
              <span className="text-muted"> / {GRAD_GOAL} credits</span>
            </div>
          </div>
          <div className="text-right text-sm text-muted">
            <div>{summary?.plannedCredits ?? 0} planned credits remaining</div>
            <div>{summary?.totalCredits ?? 0} credits mapped</div>
          </div>
        </div>
        <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-white/50">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundImage: 'var(--grad-teal-purple)' }}
          />
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading your plan…" />
      ) : terms.length === 0 ? (
        <EmptyState title="No courses planned yet">
          Add courses by semester to build your 4-year roadmap.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {terms.map(({ term, courses, credits }, i) => (
            <div key={term} className="glass-card relative overflow-hidden p-5">
              <span
                className="pointer-events-none absolute inset-0 opacity-[0.10]"
                style={{ backgroundImage: classGradient(null, i) }}
              />
              <div className="relative mb-3 flex items-center justify-between">
                <h3 className="font-bold text-ink">{term}</h3>
                <span className="text-xs font-semibold text-muted">{credits} cr</span>
              </div>
              <div className="relative space-y-2">
                {courses.map((c) => (
                  <div key={c.id} className="rounded-xl border border-white/60 bg-white/45 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-ink">{c.name}</div>
                        <div className="text-xs text-muted">
                          {[c.code, c.credits ? `${c.credits} cr` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <button
                        onClick={() => remove(c)}
                        className="text-xs text-muted transition hover:text-rose-500"
                      >
                        ✕
                      </button>
                    </div>
                    <select
                      value={c.status}
                      onChange={(e) => setStatus(c, e.target.value)}
                      className={`mt-2 cursor-pointer rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold capitalize outline-none ${STATUS_BADGE[c.status]}`}
                    >
                      <option value="planned">planned</option>
                      <option value="in_progress">in progress</option>
                      <option value="completed">completed</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddCourseModal
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AddCourseModal({ onClose, onSaved }) {
  const now = new Date();
  const [form, setForm] = useState({
    name: '',
    code: '',
    year: now.getFullYear(),
    season: SEASONS[Math.min(3, Math.floor(now.getMonth() / 3))],
    credits: '',
    status: 'planned',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/plan', {
        name: form.name,
        code: form.code || undefined,
        year: Number(form.year),
        season: form.season,
        credits: form.credits === '' ? undefined : Number(form.credits),
        status: form.status,
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal title="Add course to plan" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Field label="Course name" value={form.name} onChange={update('name')} required placeholder="Organic Chemistry" />
        <Field label="Code" value={form.code} onChange={update('code')} placeholder="CHEM 210" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Season</span>
            <select value={form.season} onChange={update('season')} className="field">
              {SEASONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <Field label="Year" type="number" value={form.year} onChange={update('year')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Credits" type="number" value={form.credits} onChange={update('credits')} placeholder="3" />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Status</span>
            <select value={form.status} onChange={update('status')} className="field">
              <option value="planned">Planned</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={saving || !form.name} className="btn btn-primary">
            {saving ? 'Adding…' : 'Add course'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink">{label}</span>
      <input {...props} className="field" />
    </label>
  );
}
