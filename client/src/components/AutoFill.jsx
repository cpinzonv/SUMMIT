import { useState } from 'react';
import { Modal, Toggle } from './ui';

/**
 * Degree Requirements — Stage R3 auto-fill UI. The dialog collects distribution
 * options; the engine (lib/distribute.js) proposes placements; the roadmap
 * renders them as GHOSTS until the student hits Apply. Nothing is written to the
 * plan without Apply.
 */

function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink">{label}</span>
      <input className="field" {...props} />
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function AutoFillDialog({ start, onRun, onClose }) {
  const [count, setCount] = useState(8);
  const [includeSummer, setIncludeSummer] = useState(false);
  const [target, setTarget] = useState(15);
  const [max, setMax] = useState(18);

  const run = () =>
    onRun({ start, count: Math.max(1, Number(count) || 1), includeSummer, target: Number(target) || 15, max: Number(max) || 18 });

  return (
    <Modal title="Auto-fill my plan" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Summit spreads your remaining <span className="font-semibold text-ink">required</span> courses across future semesters —
          respecting prerequisites, offerings, and a balanced credit load. It only proposes; you reshape everything after, and
          nothing changes until you apply.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Semesters to plan" type="number" min="1" max="16" value={count} onChange={(e) => setCount(e.target.value)} hint={`Starting ${start.season} ${start.year}`} />
          <label className="flex items-end gap-2 pb-1">
            <Toggle on={includeSummer} onChange={setIncludeSummer} />
            <span className="text-sm font-semibold text-ink">Use summer terms</span>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target credits / term" type="number" min="3" max="24" value={target} onChange={(e) => setTarget(e.target.value)} />
          <Field label="Max credits / term" type="number" min="3" max="24" value={max} onChange={(e) => setMax(e.target.value)} hint="Summer terms use a lower cap." />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="button" onClick={run} className="btn btn-primary">Auto-fill</button>
        </div>
      </div>
    </Modal>
  );
}

/** The preview banner: what's proposed + Apply / Discard. Nothing is committed until Apply. */
export function AutoFillPreviewBar({ preview, applying, onApply, onDiscard }) {
  const n = preview.placements.length;
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-300/60 bg-brand-50/70 px-5 py-3">
      <div className="text-sm text-ink">
        <span className="font-bold">Auto-fill preview</span>
        <span className="text-muted">
          {' '}— {n} course{n === 1 ? '' : 's'} proposed{preview.trayItems.length ? `, ${preview.trayItems.length} for you to choose` : ''}
          {preview.unplaceable.length ? `, ${preview.unplaceable.length} couldn’t be placed` : ''}. Nothing is saved yet.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onDiscard} className="btn btn-soft">Discard</button>
        <button type="button" onClick={onApply} disabled={applying || n === 0} className="btn btn-primary">
          {applying ? 'Applying…' : `Apply ${n} placement${n === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

/** A proposed (not-yet-committed) course in a semester card. */
export function GhostCourse({ placement }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-400/70 bg-brand-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-brand-700">{placement.code}</div>
          <div className="text-xs text-brand-600/80">{placement.credits ? `${placement.credits} cr · ` : ''}proposed</div>
        </div>
        <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Ghost</span>
      </div>
    </div>
  );
}

/** The "You choose" tray + anything the engine couldn't place. */
export function AutoFillTray({ trayItems, unplaceable }) {
  if (!trayItems.length && !unplaceable.length) return null;
  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-2">
      {trayItems.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="mb-1 text-sm font-bold text-ink">You choose</h3>
          <p className="mb-3 text-xs text-muted">These categories let you pick — Summit won&rsquo;t choose for you. Add your picks and dragging stays validated.</p>
          <ul className="space-y-3">
            {trayItems.map((t) => (
              <li key={t.categoryId} className="rounded-xl border border-white/50 bg-white/40 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{t.categoryName || 'Category'}</span>
                  <span className="text-xs font-semibold text-muted">{t.remainingCredits} cr to pick</span>
                </div>
                {t.ruleOnly ? (
                  <p className="mt-1 text-[11px] text-amber-600">Needs your input — this requirement lists no specific courses.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.candidates.map((c) => (
                      <span key={c.code} className="rounded-full border border-white/60 bg-white/60 px-2.5 py-0.5 text-[11px] text-ink">
                        {c.code}{c.credits ? ` · ${c.credits} cr` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unplaceable.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="mb-1 text-sm font-bold text-ink">Couldn&rsquo;t place</h3>
          <p className="mb-3 text-xs text-muted">Summit was honest instead of forcing these in — here&rsquo;s why.</p>
          <ul className="space-y-1.5">
            {unplaceable.map((u, i) => (
              <li key={i} className="rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-700">
                <span className="font-semibold">{u.code}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
