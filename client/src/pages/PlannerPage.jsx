import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  Modal,
  classGradient,
  gradeColor,
} from '../components/ui';
import { EmptyHero, CalendarIllustration } from '../components/EmptyHero';

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
const STATUS_BADGE = {
  planned: 'bg-slate-200 text-slate-600',
  in_progress: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABEL = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed' };
// Graduation credit goal is derived from the user's Academic Planning prefs
// (program duration × credits/year); this is just the fallback when unset.
const DEFAULT_DURATION = 4;
const DEFAULT_CREDITS_PER_YEAR = 30; // 4 × 30 = 120, a typical bachelor's

const fmtDay = (d) =>
  d
    ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

export default function PlannerPage() {
  const { preferences } = useAuth();
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'archived' ? 'archived' : 'planning';
  const setTab = (t) => setParams(t === 'archived' ? { tab: 'archived' } : {}, { replace: true });

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

  const planningItems = useMemo(() => items.filter((i) => i.status !== 'completed'), [items]);
  const archivedItems = useMemo(() => items.filter((i) => i.status === 'completed'), [items]);

  // Planning: group by term, preserving the server's chronological order.
  const terms = useMemo(() => {
    const map = new Map();
    for (const it of planningItems) {
      if (!map.has(it.term)) map.set(it.term, []);
      map.get(it.term).push(it);
    }
    return [...map.entries()].map(([term, courses]) => ({
      term,
      courses,
      credits: courses.reduce((t, c) => t + (c.credits || 0), 0),
    }));
  }, [planningItems]);

  // Archived: group by completion year (newest first).
  const archivedByYear = useMemo(() => {
    const map = new Map();
    for (const it of archivedItems) {
      const y = it.completionDate
        ? new Date(`${it.completionDate.slice(0, 10)}T00:00:00`).getFullYear()
        : it.year;
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(it);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [archivedItems]);

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
  // Roadmap length + graduation goal come from the user's Academic Planning prefs.
  const duration = Number(preferences?.academicDuration) || DEFAULT_DURATION;
  const gradGoal = duration * (Number(preferences?.creditsPerYear) || DEFAULT_CREDITS_PER_YEAR);
  const pct = Math.min(100, Math.round((completed / gradGoal) * 100));

  return (
    <div>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Academic plan</h1>
          <p className="mt-1 text-sm text-muted">
            Chart your climb to graduation, semester by semester
          </p>
        </div>
        {tab === 'planning' && (
          <button onClick={() => setAdding(true)} className="btn btn-primary">
            + Add course
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1.5">
        {[
          { key: 'planning', label: 'Planning' },
          {
            key: 'archived',
            label: `Archived${archivedItems.length ? ` (${archivedItems.length})` : ''}`,
          },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? 'bg-white/75 text-brand-700 shadow-sm' : 'text-muted hover:bg-white/50 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading your plan…" />
      ) : tab === 'planning' ? (
        <>
          {/* Roadmap-to-graduation progress */}
          <div className="glass-card relative mb-8 overflow-hidden p-6">
            <span
              className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-50 blur-2xl"
              style={{ backgroundImage: 'var(--grad-teal-purple)' }}
            />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Climb to graduation
                </div>
                <div className="mt-1 text-3xl font-extrabold">
                  <span className="text-gradient">{completed}</span>
                  <span className="text-muted"> / {gradGoal} credits</span>
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

          {terms.length === 0 ? (
            <EmptyHero
              illustration={<CalendarIllustration />}
              headline={`Build your ${duration}-year roadmap`}
              subheading="Add courses by semester. When a term starts, they move to your Dashboard automatically."
              ctaLabel="Add your first course"
              onCta={() => setAdding(true)}
            />
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
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-ink">{c.name}</div>
                            <div className="text-xs text-muted">
                              {[c.code, c.credits ? `${c.credits} cr` : null].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <button
                            onClick={() => remove(c)}
                            title="Remove from plan"
                            className="shrink-0 text-xs text-muted transition hover:text-rose-500"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[c.status]}`}>
                            {STATUS_LABEL[c.status]}
                          </span>
                          {c.status === 'in_progress' && c.linkedClassId && (
                            <Link
                              to={`/classes/${c.linkedClassId}`}
                              className="text-[11px] font-semibold text-brand-600 hover:underline"
                            >
                              View in Dashboard →
                            </Link>
                          )}
                          {c.status !== 'completed' && (
                            <button
                              onClick={() => setStatus(c, 'completed')}
                              className="ml-auto text-[11px] font-semibold text-emerald-600 hover:underline"
                            >
                              Mark complete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : archivedByYear.length === 0 ? (
        <EmptyState title="Nothing archived yet">
          Completed courses appear here. Mark a class complete on its Dashboard page (or here)
          and it lands in this tab with its final grade.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {archivedByYear.map(([year, courses]) => (
            <div key={year}>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{year}</h3>
              <div className="glass-card divide-y divide-white/40 overflow-hidden">
                {courses.map((c) => (
                  <div key={c.id} className="flex items-center gap-4 px-5 py-3.5">
                    <span
                      className="h-9 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundImage: 'var(--grad-teal-purple)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink">{c.name}</div>
                      <div className="truncate text-xs text-muted">
                        {[c.code, c.term, c.completionDate ? `Completed ${fmtDay(c.completionDate)}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <div className="text-right">
                      {c.grade && (c.grade.letter || c.grade.percentage != null) ? (
                        <>
                          <div className={`text-lg font-extrabold ${gradeColor(c.grade.percentage)}`}>
                            {c.grade.percentage != null ? `${Math.round(c.grade.percentage)}%` : '—'}
                          </div>
                          <div className="text-[10px] font-medium text-muted">{c.grade.letter || 'Final'}</div>
                        </>
                      ) : (
                        <div className="text-xs text-muted">No grade</div>
                      )}
                    </div>
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

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

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
