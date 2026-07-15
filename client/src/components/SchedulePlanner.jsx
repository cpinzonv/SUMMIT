import { useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ConfirmModal, ErrorBanner, Toggle, classGradient } from './ui';
import { WeekGrid, fitWindow, PinGlyph } from './WeekGrid';
import { generateSchedules } from '../lib/scheduleSolver';
import { rankSchedules, prefsActive } from '../lib/scheduleScore';
import { toMinutes } from '../lib/classMeetings';

/**
 * Semester Schedule Builder — Planner. Turns the saved draft sections into every
 * conflict-free schedule (Stage B solver — no AI), flips through candidates on
 * the shared week grid, pins sections to lock them, and writes a chosen schedule
 * into the 4-year roadmap.
 *
 * Stage C adds preferences that RANK the candidates (pure client-side scoring)
 * plus a single server-side Claude call that explains the top options' tradeoffs.
 * Scoring/ranking never calls AI; the advisor is the only API call.
 */

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_COL = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const norm = (code) => String(code || '').trim().toUpperCase();
const TIER = {
  great: { label: 'Great fit', cls: 'bg-emerald-100 text-emerald-700', bar: 3 },
  good: { label: 'Good fit', cls: 'bg-sky-100 text-sky-700', bar: 2 },
  compromise: { label: 'Some compromises', cls: 'bg-amber-100 text-amber-700', bar: 1 },
};

const fmt12 = (min) => {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
};
const sectionLabel = (s) => `${s.courseCode || 'Course'}${s.sectionNumber ? ` §${s.sectionNumber}` : ''}`;
const daysStr = (s) => (s.days || []).join(' ');
const timeStr = (s) => (s.startTime ? `${fmt12(toMinutes(s.startTime))}–${fmt12(toMinutes(s.endTime))}` : '');

/** Concrete { day, start, end, section } meetings for a candidate schedule. */
function candidateMeetings(schedule) {
  const out = [];
  for (const s of schedule) {
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    if (start == null || end == null) continue;
    for (const d of s.days || []) out.push({ day: d, start, end, section: s });
  }
  return out;
}

/** Compact structured summary of a candidate for the AI advisor payload. */
function candidateSummary(entry, id, rank) {
  const ms = candidateMeetings(entry.schedule);
  const usedDays = ALL_DAYS.filter((d) => ms.some((m) => m.day === d));
  const perDay = {};
  for (const d of usedDays) {
    perDay[d] = ms
      .filter((m) => m.day === d)
      .sort((a, b) => a.start - b.start)
      .map((m) => `${sectionLabel(m.section)} ${fmt12(m.start)}–${fmt12(m.end)}`)
      .join('; ');
  }
  let gapMin = 0;
  for (const d of usedDays) {
    const day = ms.filter((m) => m.day === d).sort((a, b) => a.start - b.start);
    for (let i = 1; i < day.length; i++) gapMin += Math.max(0, day[i].start - day[i - 1].end);
  }
  const starts = ms.map((m) => m.start);
  const ends = ms.map((m) => m.end);
  return {
    id,
    label: `Schedule ${rank}`,
    sectionIds: entry.schedule.map((s) => s.id),
    daysOnCampus: usedDays.length,
    earliest: starts.length ? fmt12(Math.min(...starts)) : null,
    latest: ends.length ? fmt12(Math.max(...ends)) : null,
    gapHours: Math.round((gapMin / 60) * 10) / 10,
    professors: [...new Set(ms.map((m) => m.section.professor).filter(Boolean))],
    perDay,
    compromises: entry.compromises.map((c) => c.label),
  };
}

// Group saved sections by course (stable order of first appearance), merging in
// the persisted Required/Optional flag (default Required).
function groupCourses(sections, reqMap) {
  const groups = [];
  const index = new Map();
  for (const s of sections) {
    const key = norm(s.courseCode) || `__${s.id}`;
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ key, code: s.courseCode || '', title: s.courseTitle || '', sections: [] });
    }
    groups[index.get(key)].sections.push(s);
  }
  return groups.map((g) => ({ ...g, required: reqMap[g.key] !== false }));
}

export function SchedulePlanner({ plan, sections: initialSections, requirements, preferences, onEditSections, onExit, onCommitted }) {
  // Local working copy so pin toggles re-solve instantly; persisted via the API.
  const [sections, setSections] = useState(initialSections);
  const [reqMap, setReqMap] = useState(() => {
    const m = {};
    for (const r of requirements || []) m[norm(r.courseCode)] = r.required;
    return m;
  });
  const [term, setTerm] = useState(plan.term || '');
  const [prefs, setPrefs] = useState(preferences || {});
  const [mode, setMode] = useState('setup'); // 'setup' | 'compare' | 'done'
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(null); // { term, count }
  const [advice, setAdvice] = useState(null); // { key, byId: { A: text, ... } }
  const [advising, setAdvising] = useState(false);
  // Latest prefs, updated synchronously so back-to-back edits merge instead of
  // one clobbering the other (state/props lag a render behind).
  const prefsRef = useRef(prefs);

  const courses = useMemo(() => groupCourses(sections, reqMap), [sections, reqMap]);
  const result = useMemo(() => generateSchedules(courses), [courses]);
  // Rank the solver's candidates by preference fit (pure, client-side). No prefs
  // → scores are 0 → the solver's original order is preserved.
  const ranked = useMemo(() => rankSchedules(result.schedules, prefs), [result.schedules, prefs]);
  const currentEntry = ranked[index] || null;
  const current = currentEntry?.schedule || null;

  // Distinct professors across the draft's sections — the rows in the pro-flag list.
  const allProfessors = useMemo(
    () => [...new Set(sections.map((s) => s.professor).filter(Boolean))].sort(),
    [sections],
  );

  // Identity of the current top-3 + prefs; advice is only shown while this holds,
  // and re-requesting the same key is a server cache hit (no re-bill).
  const adviceKey = useMemo(() => {
    const top = ranked.slice(0, 3).map((e) => [...e.schedule.map((s) => s.id)].sort());
    return JSON.stringify({ top, prefs });
  }, [ranked, prefs]);

  const courseColors = useMemo(() => {
    const map = {};
    courses.forEach((g, i) => { map[g.key] = classGradient({}, i); });
    return map;
  }, [courses]);

  /* ------------------------------------------------------------- persistence */
  const toggleRequired = async (group) => {
    const nextRequired = !group.required;
    setReqMap((m) => ({ ...m, [group.key]: nextRequired }));
    try {
      await api.patch(`/api/plan-builder/plan/${plan.id}/course-pref`, { courseCode: group.code || group.key, required: nextRequired });
    } catch (err) {
      setReqMap((m) => ({ ...m, [group.key]: group.required })); // revert
      setError(errorMessage(err, 'Could not save that change.'));
    }
  };

  const togglePin = async (section) => {
    const nextPinned = !section.pinned;
    setSections((list) => list.map((s) => (s.id === section.id ? { ...s, pinned: nextPinned } : s)));
    setIndex(0);
    try {
      await api.patch(`/api/plan-builder/sections/${section.id}`, { pinned: nextPinned });
    } catch (err) {
      setSections((list) => list.map((s) => (s.id === section.id ? { ...s, pinned: section.pinned } : s)));
      setError(errorMessage(err, 'Could not update the pin.'));
    }
  };

  const saveTerm = async (value) => {
    const clean = value.trim();
    if (clean === (plan.term || '')) return;
    try {
      await api.patch(`/api/plan-builder/plan/${plan.id}/term`, { term: clean || null });
      plan.term = clean; // keep the confirmation copy in sync
    } catch (err) {
      setError(errorMessage(err, 'Could not save the term.'));
    }
  };

  // Update preferences → instant client-side re-rank (no re-solve), then persist.
  // `patch` merges into the current prefs; `null` clears them.
  const savePrefs = (patch) => {
    const next = patch === null ? {} : { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    setIndex(0);
    api.patch(`/api/plan-builder/plan/${plan.id}/preferences`, { preferences: next })
      .catch((err) => setError(errorMessage(err, 'Could not save your preferences.')));
  };

  // The single AI call: explain the tradeoffs of the top 3 ranked candidates.
  const explainOptions = async () => {
    const top = ranked.slice(0, 3);
    if (!top.length) return;
    setAdvising(true); setError('');
    try {
      const ids = ['A', 'B', 'C'];
      const candidates = top.map((e, i) => candidateSummary(e, ids[i], i + 1));
      const { data } = await api.post(`/api/plan-builder/plan/${plan.id}/advise`, {
        candidates,
        preferences: prefsActive(prefs) ? prefs : {},
      });
      const byId = {};
      for (const a of data.advice || []) byId[a.id] = a.text;
      setAdvice({ key: adviceKey, byId });
    } catch (err) {
      setError(errorMessage(err, "Couldn't generate advice just now — your ranking is still ready to use."));
    } finally {
      setAdvising(false);
    }
  };

  const generate = () => { setError(''); setIndex(0); setMode('compare'); };

  const commit = async () => {
    if (!current) return;
    setCommitting(true); setError('');
    try {
      const sectionIds = current.map((s) => s.id);
      const { data } = await api.post(`/api/plan-builder/plan/${plan.id}/commit`, { sectionIds });
      setCommitted({ term: data.term, count: data.count });
      setConfirming(false);
      setMode('done');
      onCommitted?.(); // refresh the roadmap so "View my plan" shows the new courses

    } catch (err) {
      setError(errorMessage(err, 'Could not add that schedule to your plan.'));
      setConfirming(false);
    } finally {
      setCommitting(false);
    }
  };

  /* ------------------------------------------------------------------ render */
  if (mode === 'done' && committed) {
    return <DoneView committed={committed} onReplan={() => { setMode('compare'); setCommitted(null); }} onExit={onExit} />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Build your schedule</h2>
          <p className="text-sm text-muted">
            Summit finds every conflict-free way to take these courses. Pick which are required, then flip through the options.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onEditSections} className="btn btn-soft">Edit sections</button>
          {mode === 'compare' && <button type="button" onClick={() => setMode('setup')} className="btn btn-soft">Requirements</button>}
        </div>
      </div>

      <ErrorBanner message={error} />

      {result.unschedulable.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50/70 px-4 py-2.5 text-sm text-amber-700">
          {result.unschedulable.map((u) => (
            <div key={u.id}>
              <span className="font-semibold">{u.courseCode || 'A course'}{u.sectionNumber ? ` §${u.sectionNumber}` : ''}</span> has no meeting time — fix it in your sections so it can be scheduled.
            </div>
          ))}
        </div>
      )}

      {mode === 'setup' ? (
        <SetupView
          courses={courses}
          term={term}
          onTermChange={setTerm}
          onTermBlur={saveTerm}
          onToggleRequired={toggleRequired}
          onGenerate={generate}
        />
      ) : (
        <CompareView
          ranked={ranked}
          result={result}
          index={index}
          setIndex={setIndex}
          currentEntry={currentEntry}
          courses={courses}
          courseColors={courseColors}
          prefs={prefs}
          onPrefsChange={savePrefs}
          allProfessors={allProfessors}
          advice={advice?.key === adviceKey ? advice : null}
          advising={advising}
          onExplain={explainOptions}
          onTogglePin={togglePin}
          onChoose={() => setConfirming(true)}
          onEditSections={onEditSections}
        />
      )}

      {confirming && current && (
        <ConfirmModal
          title="Add this schedule to your plan?"
          message={`This adds ${current.length} class${current.length === 1 ? '' : 'es'} to your ${term || plan.term || 'semester'} plan.`}
          detail={current.map(sectionLabel).join(', ')}
          confirmLabel={committing ? 'Adding…' : 'Add to plan'}
          onConfirm={commit}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- setup sub-view */
function SetupView({ courses, term, onTermChange, onTermBlur, onToggleRequired, onGenerate }) {
  return (
    <div className="space-y-5">
      <div className="glass-card p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Which term are you planning?</span>
          <input
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
            onBlur={(e) => onTermBlur(e.target.value)}
            placeholder="e.g. Spring 2027"
            className="field max-w-xs text-sm"
          />
          <span className="mt-1 block text-[11px] text-muted">Used when you add a chosen schedule to your 4-year plan.</span>
        </label>
      </div>

      <div className="glass-card p-4">
        <h3 className="mb-1 text-sm font-bold text-ink">Which courses must you take?</h3>
        <p className="mb-3 text-xs text-muted">
          Required courses always get a section. Optional ones are included only when they fit.
        </p>
        <ul className="space-y-2">
          {courses.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/50 bg-white/40 px-3 py-2">
              <span className="min-w-0">
                <span className="text-sm font-semibold text-ink">{g.code || 'Untitled course'}</span>
                {g.title && <span className="ml-2 text-xs text-muted">{g.title}</span>}
                <span className="ml-2 text-[11px] text-muted">· {g.sections.length} section{g.sections.length === 1 ? '' : 's'}</span>
              </span>
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/60">
                {['Required', 'Optional'].map((opt) => {
                  const active = (opt === 'Required') === g.required;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => { if (!active) onToggleRequired(g); }}
                      className={`px-3 py-1 text-xs font-semibold transition ${active ? 'text-white' : 'bg-white/50 text-muted hover:text-ink'}`}
                      style={active ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" onClick={onGenerate} disabled={courses.length === 0} className="btn btn-primary w-full">
        Generate schedules
      </button>
    </div>
  );
}

/* ----------------------------------------------------------- compare sub-view */
function CompareView({
  ranked, result, index, setIndex, currentEntry, courses, courseColors,
  prefs, onPrefsChange, allProfessors, advice, advising, onExplain, onTogglePin, onChoose, onEditSections,
}) {
  const touchX = useRef(null);
  const count = ranked.length;
  const current = currentEntry?.schedule || null;
  const ranking = prefsActive(prefs);
  const adviceText = advice && index < 3 ? advice.byId[['A', 'B', 'C'][index]] : null;

  const blocks = useMemo(() => {
    if (!current) return [];
    const out = [];
    for (const s of current) {
      const key = norm(s.courseCode);
      const startMin = toMinutes(s.startTime);
      const endMin = toMinutes(s.endTime);
      for (const d of s.days || []) {
        const col = DAY_COL[d];
        if (col == null || startMin == null || endMin == null) continue;
        out.push({
          key: `${s.id}-${d}`,
          dayIdx: col,
          startMin,
          endMin,
          title: sectionLabel(s),
          subtitle: `${fmt12(startMin)}–${fmt12(endMin)}`,
          detail: s.professor || s.location || null,
          gradient: courseColors[key],
          pinned: s.pinned,
          hoverTitle: `${sectionLabel(s)} · ${fmt12(startMin)}–${fmt12(endMin)}${s.professor ? ` · ${s.professor}` : ''} — click to ${s.pinned ? 'unpin' : 'pin'}`,
          onClick: () => onTogglePin(s),
        });
      }
    }
    return out;
  }, [current, courseColors, onTogglePin]);

  const maxCol = blocks.reduce((m, b) => Math.max(m, b.dayIdx), 4);
  const days = ALL_DAYS.slice(0, maxCol + 1);
  const { startHour, endHour } = fitWindow(blocks);

  const go = (delta) => setIndex((i) => Math.min(count - 1, Math.max(0, i + delta)));
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  return (
    <div>
      <PreferencesPanel prefs={prefs} onChange={onPrefsChange} professors={allProfessors} />

      {count === 0 ? (
        <ZeroState result={result} onEditSections={onEditSections} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-ink">
                {ranking ? (count === 1 ? '1 schedule, ranked' : `${count} schedules, ranked by fit`) : (count === 1 ? '1 schedule works' : `${count} schedules work`)}
                {result.truncated && <span className="ml-1 text-xs font-medium text-muted">(showing the first {count})</span>}
              </h3>
              {result.prunedOptional.length > 0 && (
                <p className="text-[11px] text-muted">
                  Left optional {result.prunedOptional.join(', ')} out to keep this fast — pin a section to include it.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous schedule" className="btn btn-soft px-3">‹</button>
              <span className="min-w-[4.5rem] text-center text-sm font-semibold text-ink">{index + 1} of {count}</span>
              <button type="button" onClick={() => go(1)} disabled={index === count - 1} aria-label="Next schedule" className="btn btn-soft px-3">›</button>
            </div>
          </div>

          {/* Fit indicator + the concrete tradeoffs this candidate makes. */}
          {ranking && currentEntry && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FitBadge tier={currentEntry.tier} />
              {currentEntry.compromises.length === 0 ? (
                <span className="text-xs text-muted">Meets every preference you set.</span>
              ) : (
                currentEntry.compromises.map((c) => (
                  <span
                    key={c.key}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${c.heavy ? 'bg-rose-100 text-rose-700' : 'bg-white/70 text-muted'}`}
                  >
                    {c.label}
                  </span>
                ))
              )}
            </div>
          )}

          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <WeekGrid blocks={blocks} days={days} startHour={startHour} endHour={endHour} emptyLabel="—" />
          </div>

          {/* AI advisor: one calm, clearly-labelled callout on the top candidates. */}
          <AdvisorCallout
            adviceText={adviceText}
            advising={advising}
            canExplain={index < 3}
            hasAdvice={!!advice}
            onExplain={onExplain}
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">Tap a class to pin its section — Summit will only build schedules that keep your pins.</p>
            <button type="button" onClick={onChoose} className="btn btn-primary">Use this schedule</button>
          </div>
        </>
      )}

      {/* Always available — so a student can unpin even when pins caused zero results. */}
      <PinPanel courses={courses} courseColors={courseColors} onTogglePin={onTogglePin} />
    </div>
  );
}

function FitBadge({ tier }) {
  const t = TIER[tier] || TIER.good;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${t.cls}`}>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-2.5 w-1 rounded-sm ${n <= t.bar ? 'bg-current opacity-90' : 'bg-current opacity-25'}`} />
        ))}
      </span>
      {t.label}
    </span>
  );
}

/** The AI tradeoff advisor callout — clearly marked as AI-generated. */
function AdvisorCallout({ adviceText, advising, canExplain, hasAdvice, onExplain }) {
  if (adviceText) {
    return (
      <div className="mt-4 rounded-2xl border border-brand-200/70 bg-brand-50/60 p-4">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
          <SparkGlyph /> Summit advisor · AI-generated
        </div>
        <p className="text-sm leading-relaxed text-ink">{adviceText}</p>
      </div>
    );
  }
  if (!canExplain) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onExplain} disabled={advising} className="btn btn-soft">
        {advising ? 'Thinking through your options…' : hasAdvice ? 'Refresh the advice' : 'Explain my options'}
      </button>
      <span className="text-xs text-muted">A short AI read on the tradeoffs between your top schedules.</span>
    </div>
  );
}

function SparkGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
      <path d="M8 1l1.4 3.9L13 6.3 9.4 7.7 8 11.6 6.6 7.7 3 6.3l3.6-1.4L8 1zM13 10l.7 1.8L15.5 12l-1.8.7L13 14.5l-.7-1.8L10.5 12l1.8-.5L13 10z" />
    </svg>
  );
}

/* --------------------------------------------------------- preferences panel */
const GAP_OPTIONS = [
  { key: null, label: 'No preference' },
  { key: 'minimize', label: 'Minimize gaps' },
  { key: 'spread', label: 'Spread out' },
];

function prefSummary(prefs) {
  const bits = [];
  if (prefs.earliestStart) bits.push(`after ${prefs.earliestStart}`);
  if (prefs.latestEnd) bits.push(`by ${prefs.latestEnd}`);
  if (prefs.daysFree?.length) bits.push(`${prefs.daysFree.join('/')} free`);
  if (prefs.gapStyle === 'minimize') bits.push('tight');
  if (prefs.gapStyle === 'spread') bits.push('spread');
  if (prefs.fewerDays) bits.push('fewer days');
  const flags = Object.values(prefs.professors || {}).filter((v) => v === 'prefer' || v === 'avoid').length;
  if (flags) bits.push(`${flags} pro flag${flags === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

/**
 * Progressive-disclosure preferences. Collapsed once the student has set any
 * (starts open when there are none, to invite setup). Every change re-ranks
 * instantly — no re-solve — and persists in the background.
 */
function PreferencesPanel({ prefs, onChange, professors }) {
  const active = prefsActive(prefs);
  const [open, setOpen] = useState(!active);
  const set = (patch) => onChange(patch); // parent merges against the latest prefs

  const toggleDay = (d) => {
    const cur = prefs.daysFree || [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : ALL_DAYS.filter((x) => cur.includes(x) || x === d);
    set({ daysFree: next });
  };
  const setProf = (name, flag) => {
    const next = { ...(prefs.professors || {}) };
    if (flag === 'neutral') delete next[name];
    else next[name] = flag;
    set({ professors: next });
  };
  const clearAll = () => onChange(null);

  return (
    <div className="glass-card mb-4 p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink">Preferences</span>
          {active && !open && <span className="text-xs text-muted">· {prefSummary(prefs)}</span>}
          {!active && <span className="text-xs text-muted">· rank these by what matters to you</span>}
        </span>
        <span className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Nothing before</span>
              <input type="time" value={prefs.earliestStart || ''} onChange={(e) => set({ earliestStart: e.target.value || null })} className="field !py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Nothing after</span>
              <input type="time" value={prefs.latestEnd || ''} onChange={(e) => set({ latestEnd: e.target.value || null })} className="field !py-1.5 text-sm" />
            </label>
          </div>

          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Days you&rsquo;d like free</span>
            <div className="flex flex-wrap gap-1">
              {ALL_DAYS.map((d) => {
                const on = (prefs.daysFree || []).includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`h-7 w-9 rounded-md text-[11px] font-bold transition ${on ? 'text-white shadow-sm' : 'border border-white/60 bg-white/60 text-muted hover:text-ink'}`}
                    style={on ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                  >
                    {d[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Gaps between classes</span>
              <div className="flex overflow-hidden rounded-lg border border-white/60">
                {GAP_OPTIONS.map((o) => {
                  const on = (prefs.gapStyle ?? null) === o.key;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => set({ gapStyle: o.key })}
                      className={`px-3 py-1 text-xs font-semibold transition ${on ? 'text-white' : 'bg-white/50 text-muted hover:text-ink'}`}
                      style={on ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink">Fewer days on campus</span>
              <Toggle on={!!prefs.fewerDays} onChange={(v) => set({ fewerDays: v })} />
            </label>
          </div>

          {professors.length > 0 && (
            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Professors</span>
              <p className="mb-2 text-[11px] text-muted">Your own calls — Summit doesn&rsquo;t use outside ratings.</p>
              <ul className="space-y-1.5">
                {professors.map((name) => {
                  const flag = prefs.professors?.[name] || 'neutral';
                  return (
                    <li key={name} className="flex items-center justify-between gap-3 rounded-xl border border-white/50 bg-white/40 px-3 py-1.5">
                      <span className="min-w-0 truncate text-sm font-medium text-ink">{name}</span>
                      <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/60">
                        {[['prefer', 'Prefer'], ['neutral', 'Neutral'], ['avoid', 'Avoid']].map(([val, label]) => {
                          const on = flag === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setProf(name, val)}
                              className={`px-2.5 py-1 text-[11px] font-semibold transition ${on ? (val === 'avoid' ? 'text-white' : 'text-white') : 'bg-white/50 text-muted hover:text-ink'}`}
                              style={on && val !== 'avoid' ? { backgroundImage: 'var(--grad-teal-purple)' } : on && val === 'avoid' ? { backgroundColor: '#f43f5e' } : undefined}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {active && (
            <button type="button" onClick={clearAll} className="text-xs font-semibold text-brand-600 hover:underline">
              Clear preferences
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Per-course section list with pin toggles — the discoverable way to pin. */
function PinPanel({ courses, courseColors, onTogglePin }) {
  const anyPinned = courses.some((g) => g.sections.some((s) => s.pinned));
  return (
    <div className="glass-card mt-5 p-4">
      <h4 className="mb-2 text-sm font-bold text-ink">Pin sections {anyPinned && <span className="text-xs font-medium text-brand-600">· locked sections stay in every schedule</span>}</h4>
      <div className="space-y-3">
        {courses.map((g) => (
          <div key={g.key}>
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundImage: courseColors[g.key] }} />
              <span className="text-xs font-bold text-ink">{g.code || 'Untitled course'}</span>
              {!g.required && <span className="text-[10px] font-semibold uppercase text-muted">optional</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.sections.map((s) => {
                const hasTime = !!(s.startTime && s.endTime && (s.days || []).length);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!hasTime}
                    onClick={() => onTogglePin(s)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                      s.pinned
                        ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                        : hasTime
                          ? 'border-white/60 bg-white/50 text-muted hover:text-ink'
                          : 'border-amber-300/60 bg-amber-50/60 text-amber-600'
                    }`}
                    title={hasTime ? '' : 'No meeting time yet — fix it in your sections'}
                  >
                    <span className="inline-flex items-center gap-1">
                      {s.pinned && <PinGlyph />}
                      <span>§{s.sectionNumber || '—'}</span>
                      {hasTime ? <span className="opacity-70">{daysStr(s)} {timeStr(s)}</span> : <span>no time</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- zero-results */
function ZeroState({ result, onEditSections }) {
  const { reason, conflictPairs } = result;
  let headline = 'No conflict-free combination exists with these sections.';
  let sub = 'Something always overlaps. Try marking a course optional, adding another section, or fixing a meeting time.';

  if (reason?.type === 'required-empty') {
    headline = 'A required course has no scheduled section yet.';
    sub = `Add a meeting time for ${reason.courses.join(', ')} in your sections, or mark it optional.`;
  } else if (reason?.type === 'pin-conflict') {
    const pin = reason.pinnedSection;
    headline = `Your pinned ${reason.pinnedCourse} §${pin.sectionNumber || '—'} conflicts with every ${reason.blockedCourse} section.`;
    sub = 'Unpin it, or add a section that fits around it.';
  } else if (reason?.type === 'no-sections') {
    headline = 'No sections have a meeting time yet.';
    sub = 'Add days and times to your sections so Summit can place them.';
  }

  return (
    <div className="glass-card p-6 text-center">
      <h3 className="font-display text-base font-bold text-ink">{headline}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{sub}</p>

      {conflictPairs.length > 0 && (
        <div className="mx-auto mt-4 max-w-md text-left">
          <p className="mb-1.5 text-xs font-semibold text-muted">Sections that clash:</p>
          <ul className="space-y-1">
            {conflictPairs.map(([a, b], i) => (
              <li key={i} className="rounded-lg border border-rose-200/60 bg-rose-50/60 px-3 py-1.5 text-xs text-rose-700">
                <span className="font-semibold">{sectionLabel(a)}</span> <span className="opacity-70">{daysStr(a)} {timeStr(a)}</span>
                <span className="mx-1.5 opacity-60">overlaps</span>
                <span className="font-semibold">{sectionLabel(b)}</span> <span className="opacity-70">{daysStr(b)} {timeStr(b)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={onEditSections} className="btn btn-primary mt-5">Edit sections</button>
    </div>
  );
}

/* ---------------------------------------------------------------- done state */
function DoneView({ committed, onReplan, onExit }) {
  return (
    <div className="glass-card p-6 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-brand-600" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="font-display text-lg font-bold text-ink">
        Added {committed.count} class{committed.count === 1 ? '' : 'es'} to your {committed.term} plan
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        They&rsquo;re on your 4-year plan now. Your saved sections stay here, so you can try a different combination anytime.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onExit} className="btn btn-primary">View my plan</button>
        <button type="button" onClick={onReplan} className="btn btn-soft">Try another schedule</button>
      </div>
    </div>
  );
}
