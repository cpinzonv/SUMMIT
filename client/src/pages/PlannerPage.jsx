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
import { ScheduleView } from './SchedulePage';
import { SemesterPlanBuilder } from '../components/SemesterPlanBuilder';
import { RequirementsEditor } from '../components/RequirementsEditor';
import { RequirementsProgress } from '../components/RequirementsProgress';
import { computeRequirementProgress, normCode } from '../lib/requirementProgress';
import { buildRequirementIndex, buildCompletedSet, buildPlacements, buildStudentCourses, resolveCourse } from '../lib/requirementIndex';
import { canPlace, canMove, isCourseToken, semesterOrder } from '../lib/placement';
import { distributePlan, generateSemesters } from '../lib/distribute';
import { AutoFillDialog, AutoFillPreviewBar, GhostCourse, AutoFillTray } from '../components/AutoFill';

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

/** The academic term containing today — the default auto-fill start. */
function currentTerm() {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  if (m <= 4) return { season: 'Spring', year: y };
  if (m <= 7) return { season: 'Summer', year: y };
  return { season: 'Fall', year: y };
}
const STATUS_BADGE = {
  planned: 'bg-slate-200 text-slate-600',
  in_progress: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABEL = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed' };
const DEFAULT_GRAD_GOAL = 120; // fallback when the user hasn't set a requirement

const fmtDay = (d) =>
  d
    ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

export default function PlannerPage() {
  const { user } = useAuth();
  const gradGoal = user?.graduationCredits ?? DEFAULT_GRAD_GOAL;
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [requirements, setRequirements] = useState({ program: null, categories: [] });
  const [editingReqs, setEditingReqs] = useState(false);
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [preview, setPreview] = useState(null); // { placements, unplaceable, trayItems }
  const [applying, setApplying] = useState(false);
  const [params, setParams] = useSearchParams();
  // Primary view: the class roadmap ("classes"), the candidate-schedule preview
  // ("schedule"), or the Semester Schedule Builder ("builder").
  const view = ['schedule', 'builder'].includes(params.get('view')) ? params.get('view') : 'classes';
  const setView = (v) => setParams(v === 'classes' ? {} : { view: v }, { replace: true });
  // Secondary tab under Classes: planning vs archived courses.
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

  const loadRequirements = useCallback(async () => {
    try {
      const { data } = await api.get('/api/requirements');
      setRequirements(data);
    } catch {
      /* requirements are optional — a load failure just leaves the bare credit view */
    }
  }, []);

  useEffect(() => {
    load();
    loadRequirements();
  }, [load, loadRequirements]);

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

  // R2: resolve the roadmap's courses against the requirement sheet for
  // requirements-aware progress + prereq/offerings placement validation.
  const reqIndex = useMemo(() => buildRequirementIndex(requirements.categories), [requirements.categories]);
  const completedSet = useMemo(
    () => buildCompletedSet(items, requirements.completed || [], requirements.metTokens || []),
    [items, requirements.completed, requirements.metTokens],
  );
  const placements = useMemo(() => buildPlacements(items, reqIndex), [items, reqIndex]);
  const reqProgress = useMemo(
    () => computeRequirementProgress(buildStudentCourses(items, requirements.completed || []), requirements.categories),
    [items, requirements.completed, requirements.categories],
  );
  const completedIndex = useMemo(() => {
    const m = new Map();
    for (const c of requirements.completed || []) m.set(normCode(c.courseCode), c);
    return m;
  }, [requirements.completed]);

  const markCompleted = async (payload) => {
    try { const { data } = await api.post('/api/requirements/completed', payload); setRequirements((r) => ({ ...r, completed: data.completed })); }
    catch (err) { setError(errorMessage(err, 'Could not mark that course completed.')); }
  };
  const unmarkCompleted = async (id) => {
    try { const { data } = await api.delete(`/api/requirements/completed/${id}`); setRequirements((r) => ({ ...r, completed: data.completed })); }
    catch (err) { setError(errorMessage(err, 'Could not update that.')); }
  };
  const markMet = async (token) => {
    try { const { data } = await api.post('/api/requirements/met', { token }); setRequirements((r) => ({ ...r, metTokens: data.metTokens })); }
    catch (err) { setError(errorMessage(err, 'Could not update that.')); }
  };

  // canPlace for the add flow (against the current placements + completed set).
  const validateAdd = (code, season, year) =>
    canPlace({ ...resolveCourse(code, reqIndex), code }, { season, year }, placements, completedSet);

  // Move a planned course to another semester, validating the move AND its
  // downstream dependents. Returns { ok, reasons } — a blocked move is not applied.
  const moveCourse = async (item, season, year) => {
    const moved = { ...resolveCourse(item.code, reqIndex), code: item.code };
    const others = placements.filter((p) => p.id !== item.id);
    const res = canMove(moved, { season, year }, others, completedSet);
    if (!res.ok) return res;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, season, year, term: `${season} ${year}` } : i)));
    try { await api.patch(`/api/plan/${item.id}`, { season, year }); await load(); }
    catch (err) { setError(errorMessage(err)); await load(); }
    return res;
  };

  /* ---- Auto-fill (R3): propose → preview (ghosts) → apply/discard ---------- */
  const runAutofill = (opts) => {
    const semesters = generateSemesters(opts.start, opts.count, opts.includeSummer);
    // Same canPlace the manual drags use gates every placement inside the engine.
    const result = distributePlan({
      categories: reqProgress.categories,
      index: reqIndex,
      semesters,
      plan: placements,
      completed: completedSet,
      options: { target: opts.target, max: opts.max, summerMax: 8 },
    });
    setPreview(result);
    setAutofillOpen(false);
  };
  const applyPreview = async () => {
    if (!preview) return;
    setApplying(true);
    try {
      for (const p of preview.placements) {
        const meta = reqIndex.get(normCode(p.code));
        await api.post('/api/plan', { name: meta?.courseTitle || p.code, code: p.code, season: p.season, year: p.year, credits: p.credits ?? undefined, status: 'planned' });
      }
      setPreview(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not apply the plan.'));
    } finally {
      setApplying(false);
    }
  };
  const discardPreview = () => setPreview(null);

  // Term cards, with proposed placements merged in as ghosts during a preview.
  const displayTerms = useMemo(() => {
    const base = new Map();
    for (const t of terms) {
      const parts = t.term.split(' ');
      const year = Number(parts[parts.length - 1]);
      const season = parts.slice(0, -1).join(' ');
      base.set(t.term, { ...t, season, year, ghosts: [] });
    }
    if (preview) {
      for (const p of preview.placements) {
        const term = `${p.season} ${p.year}`;
        if (!base.has(term)) base.set(term, { term, season: p.season, year: p.year, courses: [], credits: 0, ghosts: [] });
        base.get(term).ghosts.push(p);
      }
    }
    return [...base.values()].sort((a, b) => semesterOrder(a.season, a.year) - semesterOrder(b.season, b.year));
  }, [terms, preview]);

  // Category bars preview the post-apply state while a preview is open.
  const displayProgress = useMemo(() => {
    if (!preview) return reqProgress;
    const ghostCourses = preview.placements.map((p) => ({ code: p.code, credits: p.credits, name: p.code, term: `${p.season} ${p.year}`, completed: false }));
    return computeRequirementProgress([...buildStudentCourses(items, requirements.completed || []), ...ghostCourses], requirements.categories);
  }, [preview, reqProgress, items, requirements.completed, requirements.categories]);

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
  const pct = Math.min(100, Math.round((completed / gradGoal) * 100));

  return (
    <div>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Academic plan</h1>
          <p className="mt-1 text-sm text-muted">
            {view === 'schedule'
              ? 'See where candidate classes would sit before you register — a future-semester preview, not your live week'
              : view === 'builder'
                ? 'Paste your school’s available sections and Summit will organize them'
                : 'Chart your climb to graduation, semester by semester'}
          </p>
        </div>
        {view === 'classes' && tab === 'planning' && (
          <div className="flex items-center gap-2">
            {requirements.program && !editingReqs && !preview && (
              <button onClick={() => setAutofillOpen(true)} className="btn btn-soft">Auto-fill my plan</button>
            )}
            <button onClick={() => setAdding(true)} className="btn btn-primary">+ Add course</button>
          </div>
        )}
      </div>

      {/* Primary view toggle: class roadmap vs. weekly schedule */}
      <div className="mb-6 flex gap-1.5">
        {[
          { key: 'classes', label: 'Planning' },
          { key: 'builder', label: 'Plan next semester' },
          { key: 'schedule', label: 'Schedule preview' },
        ].map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              view === v.key ? 'bg-white/75 text-brand-700 shadow-sm' : 'text-muted hover:bg-white/50 hover:text-ink'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'schedule' ? (
        <ScheduleView />
      ) : view === 'builder' ? (
        <SemesterPlanBuilder onPlanCommitted={load} />
      ) : (
      <>
      {/* Planning sub-tabs: active vs. archived courses */}
      <div className="mb-6 flex gap-1.5">
        {[
          { key: 'planning', label: 'Active' },
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
        editingReqs ? (
          <RequirementsEditor
            initial={requirements}
            onSaved={(data) => { setRequirements(data); setEditingReqs(false); }}
            onClose={() => setEditingReqs(false)}
          />
        ) : (
        <>
          {preview && <AutoFillPreviewBar preview={preview} applying={applying} onApply={applyPreview} onDiscard={discardPreview} />}
          {requirements.program ? (
            <RequirementsProgress
              requirements={requirements}
              progress={displayProgress}
              completedSet={completedSet}
              completedIndex={completedIndex}
              onMarkCompleted={markCompleted}
              onUnmarkCompleted={unmarkCompleted}
              onEdit={() => setEditingReqs(true)}
            />
          ) : (
          /* No requirements yet: bare credit total + a prompt to add them. */
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
            <div className="relative mt-5 flex flex-wrap items-center gap-3 border-t border-white/40 pt-4">
              <p className="text-sm text-muted">Track this against your actual degree — Summit will show per-requirement progress.</p>
              <button onClick={() => setEditingReqs(true)} className="btn btn-primary ml-auto">Add your degree requirements</button>
            </div>
          </div>
          )}

          {preview && <AutoFillTray trayItems={preview.trayItems} unplaceable={preview.unplaceable} />}

          {displayTerms.length === 0 ? (
            <EmptyHero
              illustration={<CalendarIllustration />}
              headline="Build your 4-year roadmap"
              subheading="Add courses by semester. When a term starts, they move to your Dashboard automatically."
              ctaLabel="Add your first course"
              onCta={() => setAdding(true)}
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {displayTerms.map(({ term, courses, credits, ghosts }, i) => {
                const ghostCredits = ghosts.reduce((t, g) => t + (g.credits || 0), 0);
                return (
                  <div key={term} className={`glass-card relative overflow-hidden p-5 ${ghosts.length ? 'ring-1 ring-brand-300/60' : ''}`}>
                    <span
                      className="pointer-events-none absolute inset-0 opacity-[0.10]"
                      style={{ backgroundImage: classGradient(null, i) }}
                    />
                    <div className="relative mb-3 flex items-center justify-between">
                      <h3 className="font-bold text-ink">{term}</h3>
                      <span className="text-xs font-semibold text-muted">
                        {credits + ghostCredits} cr{ghosts.length ? <span className="text-brand-600"> (+{ghostCredits})</span> : null}
                      </span>
                    </div>
                    <div className="relative space-y-2">
                      {courses.map((c) => (
                        <PlanCourseCard
                          key={c.id}
                          course={c}
                          onRemove={remove}
                          onSetStatus={setStatus}
                          onMove={moveCourse}
                          onEditOfferings={() => setEditingReqs(true)}
                          onMarkMet={markMet}
                        />
                      ))}
                      {ghosts.map((g, gi) => (
                        <GhostCourse key={`ghost-${gi}`} placement={g} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
        )
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
      </>
      )}

      {adding && (
        <AddCourseModal
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
          onValidate={validateAdd}
          onEditOfferings={() => { setAdding(false); setEditingReqs(true); }}
          onMarkMet={markMet}
        />
      )}

      {autofillOpen && (
        <AutoFillDialog start={currentTerm()} onRun={runAutofill} onClose={() => setAutofillOpen(false)} />
      )}
    </div>
  );
}

/** Renders block reasons; offers "edit offerings" and "I've met <token>" actions. */
function BlockReasons({ reasons, onEditOfferings, onMarkMet }) {
  return (
    <ul className="space-y-1">
      {reasons.map((r, i) => {
        const tokens = r.type === 'prereq' ? (r.group || []).filter((t) => !isCourseToken(t)) : [];
        return (
          <li key={i} className="rounded-lg border border-rose-200/60 bg-rose-50/70 px-3 py-2 text-xs font-medium text-rose-700">
            {r.message}
            {r.type === 'offering' && (
              <button type="button" onClick={() => onEditOfferings(r.code)} className="ml-1 font-semibold underline">edit offerings</button>
            )}
            {tokens.map((t) => (
              <button key={t} type="button" onClick={() => onMarkMet(t)} className="ml-1 font-semibold underline">I&rsquo;ve met {t}</button>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/** One planned course on the roadmap, with a prereq/offerings-validated Move. */
function PlanCourseCard({ course: c, onRemove, onSetStatus, onMove, onEditOfferings, onMarkMet }) {
  const [moving, setMoving] = useState(false);
  const [sel, setSel] = useState({ season: c.season, year: c.year });
  const [reasons, setReasons] = useState([]);
  const [busy, setBusy] = useState(false);

  const openMove = () => { setMoving((m) => !m); setReasons([]); setSel({ season: c.season, year: c.year }); };
  const apply = async () => {
    setBusy(true);
    setReasons([]);
    const res = await onMove(c, sel.season, Number(sel.year));
    setBusy(false);
    if (!res.ok) { setReasons(res.reasons); return; }
    setMoving(false);
  };

  return (
    <div className="rounded-xl border border-white/60 bg-white/45 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{c.name}</div>
          <div className="text-xs text-muted">{[c.code, c.credits ? `${c.credits} cr` : null].filter(Boolean).join(' · ')}</div>
        </div>
        <button onClick={() => onRemove(c)} title="Remove from plan" className="shrink-0 text-xs text-muted transition hover:text-rose-500">✕</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
        {c.status === 'in_progress' && c.linkedClassId && (
          <Link to={`/classes/${c.linkedClassId}`} className="text-[11px] font-semibold text-brand-600 hover:underline">View in Dashboard →</Link>
        )}
        <button onClick={openMove} className="text-[11px] font-semibold text-brand-600 hover:underline">Move</button>
        {c.status !== 'completed' && (
          <button onClick={() => onSetStatus(c, 'completed')} className="ml-auto text-[11px] font-semibold text-emerald-600 hover:underline">Mark complete</button>
        )}
      </div>
      {moving && (
        <div className="mt-2 rounded-lg border border-white/60 bg-white/60 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={sel.season} onChange={(e) => setSel((s) => ({ ...s, season: e.target.value }))} className="field !py-1 text-xs">
              {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" value={sel.year} onChange={(e) => setSel((s) => ({ ...s, year: e.target.value }))} className="field !py-1 w-20 text-xs" />
            <button onClick={apply} disabled={busy} className="btn btn-primary !py-1 text-xs">{busy ? '…' : 'Apply'}</button>
          </div>
          {reasons.length > 0 && (
            <div className="mt-2">
              <BlockReasons reasons={reasons} onEditOfferings={onEditOfferings} onMarkMet={(t) => { onMarkMet(t); setReasons([]); }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddCourseModal({ onClose, onSaved, onValidate, onEditOfferings, onMarkMet }) {
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
  const [reasons, setReasons] = useState([]);
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setReasons([]);
    // A course being ADDED as already-completed isn't a placement — only validate
    // prereqs/offerings for courses being planned into a semester.
    if (form.status !== 'completed' && form.code && onValidate) {
      const res = onValidate(form.code, form.season, Number(form.year));
      if (!res.ok) { setReasons(res.reasons); return; }
    }
    setSaving(true);
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
        {reasons.length > 0 && (
          <BlockReasons reasons={reasons} onEditOfferings={onEditOfferings} onMarkMet={(t) => { onMarkMet(t); setReasons([]); }} />
        )}
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
