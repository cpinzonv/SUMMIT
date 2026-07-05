import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, Toast } from '../components/ui';
import { activitiesApi, ACTIVITY_KINDS, STAGE_LABELS } from '../lib/activities';
import { dueStatus } from '../lib/dueDate';

const STAGES = ['backlog', 'active', 'in_progress', 'done'];
const kindLabel = (k) => ACTIVITY_KINDS.find((x) => x.value === k)?.label || 'Activity';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const isOverdue = (t) => t.dueDate && t.status !== 'done' && dueStatus(t.dueDate)?.isPastDue;

/**
 * Activity detail — the non-academic counterpart to ClassDetailPage. Shows steps,
 * progress, next action, and stage controls (NOT assignments/grades).
 */
export default function ActivityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [newStep, setNewStep] = useState({ title: '', dueDate: '' });

  const load = () => api.get(`/api/activities/${id}`).then((r) => setA(r.data.activity)).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = (msg, type = 'success') => setToast({ type, msg });
  const guard = async (fn) => { try { setA(await fn()); } catch (e) { flash(errorMessage(e), 'error'); } };

  const toggle = (t) => guard(() => activitiesApi.updateTask(t.id, { status: t.status === 'done' ? 'not_started' : 'done' }));
  const setDue = (t, val) => guard(() => activitiesApi.updateTask(t.id, { dueDate: val || null }));
  const removeStep = (t) => guard(() => activitiesApi.removeTask(t.id));
  const moveStage = (s) => guard(() => activitiesApi.setStage(id, s));
  const addStep = async (e) => {
    e.preventDefault();
    if (!newStep.title.trim()) return;
    await guard(() => activitiesApi.addTask(id, { title: newStep.title.trim(), dueDate: newStep.dueDate || null }));
    setNewStep({ title: '', dueDate: '' });
  };
  const del = async () => {
    if (!confirm(`Delete "${a.name}" and its steps?`)) return;
    try { await activitiesApi.remove(id); navigate('/'); } catch (e) { flash(errorMessage(e), 'error'); }
  };

  if (error && !a) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Link to="/" className="text-sm font-semibold text-brand-600 hover:underline">← Back to dashboard</Link>
        <ErrorBanner message={error} />
      </div>
    );
  }
  if (!a) return <Spinner label="Loading activity…" />;

  const { done, total, percent } = a.progress;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/" className="text-sm font-semibold text-brand-600 hover:underline">← Back to dashboard</Link>

      {/* Header + progress + next action + stage */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">{a.name}</h1>
            <p className="text-sm text-muted">{kindLabel(a.kind)}</p>
          </div>
          <button onClick={del} className="text-xs font-semibold text-muted transition hover:text-rose-500">Delete</button>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold text-ink">{done} of {total} step{total === 1 ? '' : 's'} complete</span>
            <span className="font-semibold text-brand-600">{total > 0 && done === 0 ? 'Planned ✓' : `${percent}%`}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/50">
            <div className="h-full rounded-full transition-all" style={{ width: `${total > 0 && percent === 0 ? 6 : percent}%`, backgroundImage: 'var(--grad-teal-purple)' }} />
          </div>
        </div>

        {a.nextAction && (
          <div className="mt-4 rounded-xl border border-brand-300/40 bg-brand-50/40 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600">Next action</div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-sm">
              <span className="text-ink">{a.nextAction.title}</span>
              {a.nextAction.dueDate && (
                <span className={`text-xs font-semibold ${isOverdue({ dueDate: a.nextAction.dueDate, status: 'x' }) ? 'text-rose-600' : 'text-muted'}`}>{fmtDate(a.nextAction.dueDate)}</span>
              )}
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-muted">Stage</div>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => moveStage(s)}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${a.stage === s ? 'text-white shadow-sm' : 'bg-white/55 text-muted hover:bg-white/80'}`}
                style={a.stage === s ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
              >
                {STAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="glass-card p-5">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Steps</h2>
        {total === 0 ? (
          <p className="text-sm text-muted">No steps yet — add a few dated steps below. Breaking it down is the whole trick to not procrastinating.</p>
        ) : (
          <div className="divide-y divide-white/40">
            {a.tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2">
                <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} className="h-4 w-4 accent-teal-500" />
                <span className={`min-w-0 flex-1 truncate text-sm ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</span>
                <input
                  type="date"
                  value={toDateInput(t.dueDate)}
                  onChange={(e) => setDue(t, e.target.value)}
                  className={`field !w-40 !py-1 text-xs ${isOverdue(t) ? '!border-rose-300 text-rose-600' : ''}`}
                  title="Due date — change to reschedule"
                />
                <button onClick={() => removeStep(t)} aria-label="Remove step" className="text-muted transition hover:text-rose-500">×</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={addStep} className="mt-3 flex items-center gap-2">
          <input value={newStep.title} onChange={(e) => setNewStep((s) => ({ ...s, title: e.target.value }))} placeholder="Add a step…" className="field flex-1" />
          <input type="date" value={newStep.dueDate} onChange={(e) => setNewStep((s) => ({ ...s, dueDate: e.target.value }))} className="field !w-40" />
          <button type="submit" className="btn btn-soft">Add</button>
        </form>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
