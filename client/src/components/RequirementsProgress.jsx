import { useMemo } from 'react';
import { computeRequirementProgress } from '../lib/requirementProgress';

/**
 * Requirements-aware roadmap header (Stage R1). Replaces the bare
 * "Climb to graduation X/120" credit total with per-category progress: for each
 * requirement category, credits satisfied by matching planned courses vs.
 * required. Planned courses that don't match any requirement are listed under
 * "Not matched to a requirement" so nothing silently disappears. Matching +
 * no-double-count rules live in lib/requirementProgress.js.
 */

function Bar({ value, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : value > 0 ? 100 : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/60">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundImage: 'var(--grad-teal-purple)' }} />
    </div>
  );
}

export function RequirementsProgress({ requirements, planItems, onEdit }) {
  const { program } = requirements;
  const { categories, notMatched, overallPlannedCredits } = useMemo(
    () => computeRequirementProgress(planItems, requirements.categories),
    [planItems, requirements.categories],
  );

  const degreeTotal = program?.totalCredits || null;

  return (
    <div className="glass-card relative mb-8 overflow-hidden p-6">
      <span
        className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-50 blur-2xl"
        style={{ backgroundImage: 'var(--grad-teal-purple)' }}
      />
      <div className="relative mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Degree progress</div>
          <div className="mt-1 text-xl font-extrabold text-ink">{program?.name || 'Your degree'}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-sm text-muted">
            <span className="text-lg font-extrabold text-gradient">{overallPlannedCredits}</span>
            {degreeTotal ? <span> / {degreeTotal} credits planned</span> : <span> credits planned</span>}
          </div>
          <button type="button" onClick={onEdit} className="btn btn-soft shrink-0">Edit requirements</button>
        </div>
      </div>

      {degreeTotal && (
        <div className="relative mb-5">
          <Bar value={overallPlannedCredits} total={degreeTotal} />
        </div>
      )}

      <div className="relative grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {categories.map((c) => {
          const required = Number(c.creditsRequired) || 0;
          const done = required > 0 && c.satisfiedCredits >= required;
          return (
            <div key={c.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-ink">
                  {c.name || 'Untitled category'}
                  {done && <span className="ml-1.5 text-xs font-bold text-emerald-600">✓</span>}
                </span>
                <span className="shrink-0 text-xs font-semibold text-muted">
                  {c.satisfiedCredits}{required ? ` / ${required}` : ''} cr
                </span>
              </div>
              <Bar value={c.satisfiedCredits} total={required} />
              {c.notes && <p className="mt-1 text-[11px] text-muted">{c.notes}</p>}
            </div>
          );
        })}
      </div>

      {notMatched.length > 0 && (
        <div className="relative mt-5 rounded-2xl border border-white/50 bg-white/40 p-4">
          <p className="mb-1.5 text-xs font-semibold text-muted">
            Not matched to a requirement <span className="font-normal">({notMatched.length})</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {notMatched.map((m, i) => (
              <span key={i} className="rounded-full border border-white/60 bg-white/60 px-2.5 py-0.5 text-[11px] text-ink">
                {m.code || m.name}{m.credits != null ? ` · ${m.credits} cr` : ''}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">These planned courses still count toward your total — they just don&rsquo;t map to a listed requirement yet.</p>
        </div>
      )}
    </div>
  );
}
