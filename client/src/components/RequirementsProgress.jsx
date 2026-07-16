import { useMemo, useState } from 'react';
import { normCode } from '../lib/requirementProgress';

/**
 * Requirements-aware roadmap header (R1 + R2). Per-category progress with credits
 * satisfied vs required, split into COMPLETED (solid) and PLANNED (hatched)
 * segments. Each category expands to its requirement courses, where a checkmark
 * marks a course completed/transferred. A "Completed & transferred" panel lists
 * everything the student already has and takes manual entries. Planned courses
 * that don't match a requirement stay visible under "Not matched".
 */

const HATCH = 'repeating-linear-gradient(45deg, rgba(63,177,184,0.65) 0 4px, rgba(63,177,184,0.18) 4px 8px)';

function SplitBar({ completed = 0, planned = 0, required = 0 }) {
  const denom = required > 0 ? required : Math.max(completed + planned, 1);
  const cPct = Math.min(100, (completed / denom) * 100);
  const pPct = Math.min(100 - cPct, (planned / denom) * 100);
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-white/60">
      <div className="h-full" style={{ width: `${cPct}%`, backgroundImage: 'var(--grad-teal-purple)' }} title="completed" />
      <div className="h-full" style={{ width: `${pPct}%`, backgroundImage: HATCH }} title="planned" />
    </div>
  );
}

export function RequirementsProgress({
  requirements, progress, completedSet, completedIndex,
  onMarkCompleted, onUnmarkCompleted, onEdit,
}) {
  const { program } = requirements;
  const { categories, notMatched, overallCompletedCredits, overallPlannedCredits } = progress;
  const [openCat, setOpenCat] = useState(null);
  const degreeTotal = program?.totalCredits || null;
  const totalPlanned = overallCompletedCredits + overallPlannedCredits;

  const toggle = (co) => {
    const key = normCode(co.courseCode);
    if (completedSet.has(key)) {
      const entry = completedIndex.get(key);
      if (entry) onUnmarkCompleted(entry.id); // only completed_courses can be unmarked here
    } else {
      onMarkCompleted({ courseCode: co.courseCode, courseTitle: co.courseTitle, credits: co.credits, source: 'completed' });
    }
  };

  return (
    <div className="glass-card relative mb-8 overflow-hidden p-6">
      <span className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-50 blur-2xl" style={{ backgroundImage: 'var(--grad-teal-purple)' }} />

      <div className="relative mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Degree progress</div>
          <div className="mt-1 text-xl font-extrabold text-ink">{program?.name || 'Your degree'}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-sm text-muted">
            <span className="text-lg font-extrabold text-gradient">{totalPlanned}</span>
            {degreeTotal ? <span> / {degreeTotal} credits</span> : <span> credits</span>}
            <div className="text-[11px]">{overallCompletedCredits} completed · {overallPlannedCredits} planned</div>
          </div>
          <button type="button" onClick={onEdit} className="btn btn-soft shrink-0">Edit requirements</button>
        </div>
      </div>

      {degreeTotal && (
        <div className="relative mb-5">
          <SplitBar completed={overallCompletedCredits} planned={overallPlannedCredits} required={degreeTotal} />
        </div>
      )}

      <div className="relative grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {categories.map((c) => {
          const required = Number(c.creditsRequired) || 0;
          const done = required > 0 && c.satisfiedCredits >= required;
          const open = openCat === c.id;
          return (
            <div key={c.id}>
              <button type="button" onClick={() => setOpenCat(open ? null : c.id)} className="mb-1 flex w-full items-baseline justify-between gap-2 text-left">
                <span className="min-w-0 truncate text-sm font-semibold text-ink">
                  {c.name || 'Untitled category'}
                  {done && <span className="ml-1.5 text-xs font-bold text-emerald-600">✓</span>}
                </span>
                <span className="shrink-0 text-xs font-semibold text-muted">
                  {c.satisfiedCredits}{required ? ` / ${required}` : ''} cr
                  <span className={`ml-1 inline-block transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
                </span>
              </button>
              <SplitBar completed={c.completedCredits} planned={c.plannedCredits} required={required} />
              {c.notes && <p className="mt-1 text-[11px] text-muted">{c.notes}</p>}

              {open && (c.courses?.length ? (
                <ul className="mt-2 space-y-1">
                  {c.courses.map((co) => {
                    const key = normCode(co.courseCode);
                    const isDone = completedSet.has(key);
                    const canUnmark = isDone ? completedIndex.has(key) : true;
                    return (
                      <li key={co.id} className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => canUnmark && toggle(co)}
                          disabled={isDone && !canUnmark}
                          title={isDone && !canUnmark ? 'Completed in your plan' : isDone ? 'Mark not completed' : 'Mark completed / transferred'}
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                            isDone ? 'border-brand-500 bg-brand-500 text-white' : 'border-white/70 bg-white/60 text-transparent hover:border-brand-400'
                          } ${isDone && !canUnmark ? 'opacity-70' : ''}`}
                        >
                          ✓
                        </button>
                        <span className={`min-w-0 truncate ${isDone ? 'text-muted line-through' : 'text-ink'}`}>
                          {co.courseCode}{co.credits ? ` · ${co.credits} cr` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : open ? (
                <p className="mt-2 text-[11px] text-muted">No specific courses listed — mark completed courses below.</p>
              ) : null)}
            </div>
          );
        })}
      </div>

      <CompletedPanel completed={requirements.completed || []} onAdd={onMarkCompleted} onRemove={onUnmarkCompleted} />

      {notMatched.length > 0 && (
        <div className="relative mt-4 rounded-2xl border border-white/50 bg-white/40 p-4">
          <p className="mb-1.5 text-xs font-semibold text-muted">Not matched to a requirement <span className="font-normal">({notMatched.length})</span></p>
          <div className="flex flex-wrap gap-1.5">
            {notMatched.map((m, i) => (
              <span key={i} className={`rounded-full border border-white/60 px-2.5 py-0.5 text-[11px] ${m.completed ? 'bg-brand-50 text-brand-700' : 'bg-white/60 text-ink'}`}>
                {m.code || m.name}{m.credits != null ? ` · ${m.credits} cr` : ''}{m.completed ? ' · done' : ''}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">These still count toward your total — they just don&rsquo;t map to a listed requirement yet.</p>
        </div>
      )}
    </div>
  );
}

const SOURCE_LABEL = { completed: 'Completed', transferred: 'Transfer', ap: 'AP' };

/** The student's completed/transferred ledger + a manual add form. */
function CompletedPanel({ completed, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ courseCode: '', credits: '', source: 'transferred' });

  const submit = (e) => {
    e.preventDefault();
    if (!form.courseCode.trim()) return;
    onAdd({ courseCode: form.courseCode.trim(), credits: form.credits === '' ? null : form.credits, source: form.source });
    setForm({ courseCode: '', credits: '', source: 'transferred' });
    setOpen(false);
  };

  return (
    <div className="relative mt-5 rounded-2xl border border-white/50 bg-white/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted">Completed &amp; transferred <span className="font-normal">({completed.length})</span></p>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-brand-600 hover:underline">
          {open ? 'Cancel' : '+ I took this / transferred it'}
        </button>
      </div>

      {completed.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {completed.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-brand-200/70 bg-brand-50/70 px-2.5 py-0.5 text-[11px] text-brand-700">
              <span className="font-semibold">{c.courseCode}</span>
              {c.credits != null && <span>· {c.credits} cr</span>}
              <span className="opacity-70">· {SOURCE_LABEL[c.source] || 'Completed'}</span>
              <button type="button" onClick={() => onRemove(c.id)} aria-label="Remove" className="ml-0.5 font-bold text-rose-500 hover:text-rose-700">×</button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Course code</span>
            <input value={form.courseCode} onChange={(e) => setForm((f) => ({ ...f, courseCode: e.target.value }))} placeholder="MATH 161" className="field !py-1.5 text-sm" autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Credits</span>
            <input type="number" value={form.credits} onChange={(e) => setForm((f) => ({ ...f, credits: e.target.value }))} placeholder="4" className="field !py-1.5 w-20 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Source</span>
            <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} className="field !py-1.5 text-sm">
              <option value="transferred">Transfer</option>
              <option value="ap">AP</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <button type="submit" className="btn btn-primary !py-1.5">Add</button>
        </form>
      )}
    </div>
  );
}
