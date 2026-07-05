import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { Spinner, ErrorBanner, Toast } from '../components/ui';
import { CreateActivityModal } from '../components/CreateActivityModal';
import { activitiesApi, ACTIVITY_KINDS, STAGE_LABELS } from '../lib/activities';
import { dueStatus } from '../lib/dueDate';

const kindLabel = (k) => ACTIVITY_KINDS.find((x) => x.value === k)?.label || k;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);
const isOverdue = (t) => t.dueDate && t.status !== 'done' && dueStatus(t.dueDate)?.isPastDue;

const STAGE_STYLE = {
  backlog: 'bg-slate-200 text-slate-600',
  active: 'bg-sky-50 text-sky-600',
  in_progress: 'bg-indigo-50 text-indigo-600',
  done: 'bg-emerald-50 text-emerald-600',
};

/**
 * Activities — PR A minimal list (create + progress + collapsible sub-tasks).
 * The full Kanban board + WIP-enforced drag lands in Phase B.
 */
export default function ActivitiesPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null); // { activities, wip }
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [creating, setCreating] = useState(params.get('new') === '1');

  const load = () => activitiesApi.list().then(setData).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const openCreate = () => setCreating(true);
  const closeCreate = () => { setCreating(false); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };

  const patchActivity = (updated) =>
    setData((d) => ({ ...d, activities: d.activities.map((a) => (a.id === updated.id ? updated : a)) }));

  const toggleTask = async (task) => {
    try {
      const updated = await activitiesApi.updateTask(task.id, { status: task.status === 'done' ? 'not_started' : 'done' });
      patchActivity(updated);
      load(); // refresh WIP / stage after auto-complete
    } catch (e) {
      setToast({ type: 'error', msg: errorMessage(e) });
    }
  };

  const removeActivity = async (a) => {
    if (!confirm(`Delete "${a.name}" and its steps?`)) return;
    try {
      await activitiesApi.remove(a.id);
      setToast({ type: 'success', msg: 'Activity deleted' });
      load();
    } catch (e) {
      setToast({ type: 'error', msg: errorMessage(e) });
    }
  };

  if (!data && !error) return <Spinner label="Loading activities…" />;

  const wip = data?.wip;
  const atLimit = wip && wip.count >= wip.limit;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Activities</h1>
          <p className="text-sm text-muted">Projects for clubs, freelance, volunteering — broken into steps so they actually get done.</p>
        </div>
        <div className="flex items-center gap-3">
          {wip && (
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${atLimit ? 'bg-rose-100 text-rose-700' : 'bg-white/60 text-muted'}`} title="In-flight = Active + In Progress (max 3)">
              Active: {wip.count}/{wip.limit}
            </span>
          )}
          <button onClick={openCreate} className="btn btn-primary">+ New activity</button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {data?.activities.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm text-muted">No activities yet. Start one and break it into a few dated steps — that's the whole trick to not procrastinating.</p>
          <button onClick={openCreate} className="btn btn-primary mt-4">Create your first activity</button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data?.activities.map((a) => (
            <ActivityCard key={a.id} activity={a} onToggleTask={toggleTask} onDelete={() => removeActivity(a)} />
          ))}
        </div>
      )}

      {creating && (
        <CreateActivityModal
          onClose={closeCreate}
          onCreated={() => { closeCreate(); setToast({ type: 'success', msg: 'Activity created' }); load(); }}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

function ActivityCard({ activity: a, onToggleTask, onDelete }) {
  const [open, setOpen] = useState(false);
  const { done, total, percent } = a.progress;

  return (
    <div className="glass-card overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold text-ink">{a.name}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span className="text-muted">{kindLabel(a.kind)}</span>
            <span className={`rounded-full px-2 py-0.5 font-bold ${STAGE_STYLE[a.stage]}`}>{STAGE_LABELS[a.stage]}</span>
          </div>
        </div>
        <button onClick={onDelete} aria-label="Delete activity" className="shrink-0 text-muted transition hover:text-rose-500">×</button>
      </div>

      {/* Progress bar (endowed progress: a broken-down activity reads "planned", never a bleak 0%). */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-semibold text-ink">{done} of {total} step{total === 1 ? '' : 's'} complete</span>
          {total > 0 && done === 0 && <span className="font-semibold text-brand-600">Planned ✓</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/50">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${total > 0 && percent === 0 ? 6 : percent}%`, backgroundImage: 'var(--grad-teal-purple)' }}
          />
        </div>
      </div>

      {/* Next action */}
      {a.nextAction && (
        <div className="mt-3 rounded-xl border border-brand-300/40 bg-brand-50/40 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600">Next action</div>
          <div className="mt-0.5 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-ink">{a.nextAction.title}</span>
            {a.nextAction.dueDate && (
              <span className={`shrink-0 text-xs font-semibold ${isOverdue({ dueDate: a.nextAction.dueDate, status: 'x' }) ? 'text-rose-600' : 'text-muted'}`}>
                {fmtDate(a.nextAction.dueDate)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Collapsible sub-tasks */}
      {total > 0 && (
        <>
          <button onClick={() => setOpen((o) => !o)} className="mt-3 text-xs font-semibold text-muted hover:text-ink">
            {open ? '▾ Hide steps' : `▸ Show ${total} step${total === 1 ? '' : 's'}`}
          </button>
          {open && (
            <div className="mt-2 space-y-1">
              {a.tasks.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-white/50">
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => onToggleTask(t)} className="h-4 w-4 accent-teal-500" />
                  <span className={`flex-1 truncate ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</span>
                  {t.dueDate && (
                    <span className={`text-xs font-medium ${isOverdue(t) ? 'text-rose-600' : 'text-muted'}`}>
                      {fmtDate(t.dueDate)}{isOverdue(t) ? ' · overdue' : ''}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
