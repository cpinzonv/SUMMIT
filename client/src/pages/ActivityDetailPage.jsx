import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, Toast } from '../components/ui';
import { activitiesApi, ACTIVITY_KINDS, STAGE_LABELS, STAGES, activityProjectProgress } from '../lib/activities';
import { dueStatus } from '../lib/dueDate';

const kindLabel = (k) => ACTIVITY_KINDS.find((x) => x.value === k)?.label || 'Activity';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const isOverdue = (t) => t.dueDate && !t.done && dueStatus(t.dueDate)?.isPastDue;

const STAGE_STYLE = {
  backlog: 'bg-slate-200 text-slate-600',
  active: 'bg-sky-50 text-sky-600',
  in_progress: 'bg-indigo-50 text-indigo-600',
  done: 'bg-emerald-50 text-emerald-600',
};

function ProgressBar({ done, total, percent, unit = 'step' }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-ink">{done} of {total} {unit}{total === 1 ? '' : 's'} complete</span>
        <span className="font-semibold text-brand-600">{total > 0 && done === 0 ? 'Planned ✓' : `${percent}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/50">
        <div className="h-full rounded-full transition-all" style={{ width: `${total > 0 && percent === 0 ? 6 : percent}%`, backgroundImage: 'var(--grad-teal-purple)' }} />
      </div>
    </div>
  );
}

/**
 * Activity detail — the 3-level view. An activity holds Projects (collapsible,
 * each with a Kanban stage + progress) and each project holds Tasks (checkbox,
 * due date, reschedule). Activity progress aggregates all tasks. Not classes/grades.
 */
export default function ActivityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [addingProject, setAddingProject] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = () => api.get(`/api/activities/${id}`).then((r) => setA(r.data.activity)).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = (msg, type = 'success') => setToast({ type, msg });
  const guard = async (fn) => { try { setA(await fn()); } catch (e) { flash(errorMessage(e), 'error'); } };

  const del = async () => {
    if (!confirm(`Delete "${a.name}" and everything in it?`)) return;
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/" className="text-sm font-semibold text-brand-600 hover:underline">← Back to dashboard</Link>

      {/* Activity header + aggregate progress + next action */}
      <div className="glass-card p-6">
        {editing ? (
          <ActivityEditForm
            activity={a}
            onCancel={() => setEditing(false)}
            onSave={async (patch) => { await guard(() => activitiesApi.update(id, patch)); setEditing(false); }}
          />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold text-ink">{a.name}</h1>
              <p className="text-sm text-muted">{kindLabel(a.kind)} · {a.projectCount} project{a.projectCount === 1 ? '' : 's'}</p>
            </div>
            <ActivityMenu onEdit={() => setEditing(true)} onDelete={del} />
          </div>
        )}
        <div className="mt-4"><ProgressBar {...activityProjectProgress(a)} unit="project" /></div>
        {a.nextAction && (
          <div className="mt-4 rounded-xl border border-brand-300/40 bg-brand-50/40 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600">Next action</div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-sm">
              <span className="text-ink">{a.nextAction.title}</span>
              {a.nextAction.dueDate && (
                <span className={`text-xs font-semibold ${dueStatus(a.nextAction.dueDate)?.isPastDue ? 'text-rose-600' : 'text-muted'}`}>{fmtDate(a.nextAction.dueDate)}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Projects */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-ink">Projects</h2>
        <button onClick={() => setAddingProject((v) => !v)} className="btn btn-primary">+ Add project</button>
      </div>

      {addingProject && (
        <AddProjectForm
          onCancel={() => setAddingProject(false)}
          onSubmit={async (payload) => { await guard(() => activitiesApi.addProject(id, payload)); setAddingProject(false); }}
        />
      )}

      {a.projects.length === 0 && !addingProject ? (
        <div className="glass-card p-8 text-center text-sm text-muted">
          No projects yet. Add a sub-goal (e.g. “Spring showcase”) and break it into a few dated steps.
        </div>
      ) : (
        <div className="space-y-3">
          {a.projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onStage={(stage) => guard(() => activitiesApi.setProjectStage(p.id, stage))}
              onUpdate={(patch) => guard(() => activitiesApi.updateProject(p.id, patch))}
              onDelete={() => { if (confirm(`Delete project "${p.name}"?`)) guard(() => activitiesApi.removeProject(p.id)); }}
              onToggleTask={(t) => guard(() => activitiesApi.updateTask(t.id, { done: !t.done }))}
              onUpdateTask={(t, patch) => guard(() => activitiesApi.updateTask(t.id, patch))}
              onDeleteTask={(t) => guard(() => activitiesApi.removeTask(t.id))}
              onAddTask={(title, dueDate) => guard(() => activitiesApi.addTask(p.id, { title, dueDate: dueDate || null }))}
            />
          ))}
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}

/* ---- ⋮ menu on the activity header (Edit · Delete) --------------------- */
function ActivityMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Activity options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full text-xl leading-none text-muted transition hover:bg-white/60 hover:text-ink"
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="glass-panel absolute right-0 z-20 mt-1 w-44 p-1.5 text-sm shadow-xl">
          <button type="button" role="menuitem" onClick={pick(onEdit)} className="menu-item"><span>✎</span> Edit activity</button>
          <button type="button" role="menuitem" onClick={pick(onDelete)} className="menu-item text-rose-600"><span>🗑</span> Delete activity</button>
        </div>
      )}
    </div>
  );
}

/* ---- Inline edit for the activity header (name + kind) ----------------- */
function ActivityEditForm({ activity: a, onCancel, onSave }) {
  const [name, setName] = useState(a.name);
  const [kind, setKind] = useState(a.kind);
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave({ name: name.trim(), kind }); } finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Activity name"
        className="field w-full font-display text-lg font-bold"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="field !w-auto">
          {ACTIVITY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onCancel} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={saving || !name.trim()} className="btn btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form>
  );
}

/* ---- Project card (collapsible, stage controls, tasks) ------------------ */
function ProjectCard({ project: p, onStage, onUpdate, onDelete, onToggleTask, onUpdateTask, onDeleteTask, onAddTask }) {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState({ title: '', dueDate: '' });
  const { done, total, percent } = p.progress;

  const addStep = (e) => {
    e.preventDefault();
    if (!step.title.trim()) return;
    onAddTask(step.title.trim(), step.dueDate);
    setStep({ title: '', dueDate: '' });
  };

  return (
    <div className="glass-card overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-muted">{open ? '▾' : '▸'}</span>
            <h3 className="truncate font-display text-base font-bold text-ink">{p.name}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_STYLE[p.stage]}`}>{STAGE_LABELS[p.stage]}</span>
          </div>
        </button>
        <button onClick={onDelete} aria-label="Delete project" className="shrink-0 text-muted transition hover:text-rose-500">×</button>
      </div>

      <div className="mt-3"><ProgressBar done={done} total={total} percent={percent} /></div>

      {/* Stage controls (project level) */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => onStage(s)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${p.stage === s ? 'text-white shadow-sm' : 'bg-white/55 text-muted hover:bg-white/80'}`}
            style={p.stage === s ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
          >
            {STAGE_LABELS[s]}
          </button>
        ))}
      </div>

      {open && (
        <div className="mt-3">
          {/* Project description */}
          <NoteField
            value={p.description}
            onSave={(v) => onUpdate({ description: v })}
            placeholder="Add a description for this project…"
            className="mb-3"
          />

          {total === 0 ? (
            <p className="text-sm text-muted">No steps yet — add 3+ dated steps to break this down.</p>
          ) : (
            <div className="divide-y divide-white/40">
              {p.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => onToggleTask(t)}
                  onUpdate={(patch) => onUpdateTask(t, patch)}
                  onDelete={() => onDeleteTask(t)}
                />
              ))}
            </div>
          )}
          <form onSubmit={addStep} className="mt-2 flex items-center gap-2">
            <input value={step.title} onChange={(e) => setStep((s) => ({ ...s, title: e.target.value }))} placeholder="Add a step…" className="field flex-1" />
            <input type="date" value={step.dueDate} onChange={(e) => setStep((s) => ({ ...s, dueDate: e.target.value }))} className="field !w-36" />
            <button type="submit" className="btn btn-soft">Add</button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ---- Task row (expand to edit title + description) --------------------- */
function TaskRow({ task: t, onToggle, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const hasNote = Boolean(t.description);

  return (
    <div className="py-2">
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={t.done} onChange={onToggle} className="h-4 w-4 accent-teal-500" />
        {open ? (
          <input
            defaultValue={t.title}
            key={`title-${t.id}-${t.title}`}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) onUpdate({ title: v }); }}
            className="field min-w-0 flex-1 !py-1 text-sm"
            placeholder="Step title"
            aria-label="Step title"
          />
        ) : (
          <button
            onClick={() => setOpen(true)}
            className={`min-w-0 flex-1 truncate text-left text-sm ${t.done ? 'text-muted line-through' : 'text-ink'}`}
            title="Open step to add details"
          >
            {t.title}
            {hasNote && <span className="ml-1.5 text-xs text-muted" title="Has details">📝</span>}
          </button>
        )}
        <input
          type="date"
          value={toDateInput(t.dueDate)}
          onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
          className={`field !w-36 !py-1 text-xs ${isOverdue(t) ? '!border-rose-300 text-rose-600' : ''}`}
          title="Due date — change to reschedule"
        />
        <button onClick={() => setOpen((o) => !o)} aria-label="Details" className={`text-sm transition ${open ? 'text-ink' : 'text-muted hover:text-ink'}`}>
          {open ? '▾' : '⋯'}
        </button>
        <button onClick={onDelete} aria-label="Remove step" className="text-muted transition hover:text-rose-500">×</button>
      </div>

      {open && (
        <div className="mt-2 pl-7">
          <NoteField
            value={t.description}
            onSave={(v) => onUpdate({ description: v })}
            placeholder="Add details or notes for this step…"
          />
        </div>
      )}
    </div>
  );
}

/* ---- Editable note / description (saves on blur) ---------------------- */
function NoteField({ value, onSave, placeholder, className = '' }) {
  return (
    <textarea
      defaultValue={value || ''}
      key={value || ''}
      rows={2}
      onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (value || null)) onSave(v); }}
      placeholder={placeholder}
      className={`field w-full resize-y text-sm ${className}`}
    />
  );
}

/* ---- Add-project form (name + 3-task soft nudge, Option C) -------------- */
const emptyRow = () => ({ title: '', dueDate: '' });
function AddProjectForm({ onCancel, onSubmit }) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.title.trim());

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the project a name.');
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), tasks: filled.map((r) => ({ title: r.title.trim(), dueDate: r.dueDate || null })) });
    } catch {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-card space-y-3 p-4">
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">Project name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring showcase" className="field" autoFocus />
      </label>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-ink">Steps</span>
          <span className="text-xs text-muted">{filled.length} step{filled.length === 1 ? '' : 's'}</span>
        </div>
        <p className="mb-2 text-xs text-brand-600">3+ dated steps per project is the sweet spot — optional, but it really helps you start.</p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} placeholder={`Step ${i + 1}`} className="field flex-1" />
              <input type="date" value={r.dueDate} onChange={(e) => setRow(i, { dueDate: e.target.value })} className="field !w-36" />
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove step" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-black/5 hover:text-rose-500">×</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, emptyRow()])} className="mt-2 text-sm font-semibold text-brand-600 hover:underline">+ Add a step</button>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-soft">Cancel</button>
        <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Adding…' : 'Add project'}</button>
      </div>
    </form>
  );
}
