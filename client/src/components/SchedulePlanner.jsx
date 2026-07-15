import { useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ConfirmModal, ErrorBanner, classGradient } from './ui';
import { WeekGrid, fitWindow, PinGlyph } from './WeekGrid';
import { generateSchedules } from '../lib/scheduleSolver';
import { toMinutes } from '../lib/classMeetings';

/**
 * Semester Schedule Builder — Stage B (Planner). Turns the saved draft sections
 * into every conflict-free schedule: the student marks each course Required or
 * Optional, generates combinations (pure client-side solver — no AI), flips
 * through candidates on the shared week grid, pins sections to lock them, and
 * chooses one to write into the 4-year roadmap for the plan's term.
 *
 * Solver + compare + pinning only. No preferences, ranking, or AI advice.
 */

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_COL = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const norm = (code) => String(code || '').trim().toUpperCase();

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

export function SchedulePlanner({ plan, sections: initialSections, requirements, onEditSections, onExit, onCommitted }) {
  // Local working copy so pin toggles re-solve instantly; persisted via the API.
  const [sections, setSections] = useState(initialSections);
  const [reqMap, setReqMap] = useState(() => {
    const m = {};
    for (const r of requirements || []) m[norm(r.courseCode)] = r.required;
    return m;
  });
  const [term, setTerm] = useState(plan.term || '');
  const [mode, setMode] = useState('setup'); // 'setup' | 'compare' | 'done'
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(null); // { term, count }

  const courses = useMemo(() => groupCourses(sections, reqMap), [sections, reqMap]);
  const result = useMemo(() => generateSchedules(courses), [courses]);
  const current = result.schedules[index] || null;

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
          result={result}
          index={index}
          setIndex={setIndex}
          current={current}
          courses={courses}
          courseColors={courseColors}
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
function CompareView({ result, index, setIndex, current, courses, courseColors, onTogglePin, onChoose, onEditSections }) {
  const touchX = useRef(null);
  const count = result.count;

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
      {count === 0 ? (
        <ZeroState result={result} onEditSections={onEditSections} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-ink">
                {count === 1 ? '1 schedule works' : `${count} schedules work`}
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

          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <WeekGrid blocks={blocks} days={days} startHour={startHour} endHour={endHour} emptyLabel="—" />
          </div>

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
