import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, Toast } from './ui';

/**
 * Semester Schedule Builder — Stage A (Planner). Paste (or screenshot) a school's
 * available-course-sections listing; Claude extracts structured sections; the
 * student reviews and corrects them in an editable table; sections persist to a
 * draft semester plan. Extraction + review + persistence only — no solver yet.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const rid = () => Math.random().toString(36).slice(2);
const blankSection = (courseCode = '', courseTitle = '') => ({
  _id: rid(), courseCode, courseTitle, sectionNumber: '', days: [], startTime: '', endTime: '', professor: '', location: '',
});
const hasContent = (s) => s.courseCode || s.courseTitle || s.startTime || (s.days || []).length;

// Group a list of sections by course code (keeps input order of first appearance).
function groupByCourse(sections) {
  const groups = [];
  const index = new Map();
  for (const s of sections) {
    const key = (s.courseCode || '').trim().toUpperCase() || `__${s._id || s.id}`;
    if (!index.has(key)) { index.set(key, groups.length); groups.push({ key, code: s.courseCode || '', title: s.courseTitle || '', items: [] }); }
    groups[index.get(key)].items.push(s);
  }
  return groups;
}

export function SemesterPlanBuilder() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null); // { id, term }
  const [saved, setSaved] = useState([]); // persisted sections
  const [step, setStep] = useState('paste'); // 'paste' | 'review' | 'saved'
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Paste inputs — preserved across a failed extraction so nothing is lost.
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [extracting, setExtracting] = useState(false);

  // Review draft (local until confirmed).
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/api/plan-builder/plan')
      .then(({ data }) => { if (!alive) return; setPlan(data.plan); setSaved(data.sections); setStep(data.sections.length ? 'saved' : 'paste'); })
      .catch((err) => { if (alive) setError(errorMessage(err, 'Could not load your plan.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const runExtract = async () => {
    if (!text.trim() && !image) { setError('Paste your course listing or add a screenshot first.'); return; }
    setExtracting(true); setError('');
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('text', text);
      if (image) fd.append('image', image);
      const { data } = await api.post('/api/plan-builder/extract', fd);
      const rows = (data.sections || []).map((s) => ({ ...s, _id: rid() }));
      if (!rows.length) { setError("Couldn't find any sections in that. Try pasting the text directly."); return; }
      setDraft(rows);
      setStep('review');
    } catch (err) {
      // Raw input stays put so the student doesn't lose their paste.
      setError(errorMessage(err, "Couldn't read that — try pasting the text directly."));
    } finally {
      setExtracting(false);
    }
  };

  const saveDraft = async () => {
    const clean = draft.filter(hasContent);
    if (!clean.length) { setError('Add at least one section before saving.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post(`/api/plan-builder/plan/${plan.id}/sections`, { sections: clean });
      setSaved(data.sections);
      setDraft([]); setText(''); setImage(null);
      setStep('saved');
      setToast({ type: 'success', msg: `Saved ${clean.length} section${clean.length === 1 ? '' : 's'}.` });
    } catch (err) {
      setError(errorMessage(err, 'Could not save those sections.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteSaved = async (id) => {
    const prev = saved;
    setSaved((s) => s.filter((x) => x.id !== id));
    try { await api.delete(`/api/plan-builder/sections/${id}`); }
    catch { setSaved(prev); setToast({ type: 'error', msg: 'Could not remove that section.' }); }
  };

  if (loading) return <Spinner label="Loading your plan…" />;

  return (
    <div>
      {step === 'paste' && (
        <PasteStep
          text={text} setText={setText} image={image} setImage={setImage}
          extracting={extracting} error={error} onExtract={runExtract}
          onCancel={saved.length ? () => { setError(''); setStep('saved'); } : null}
        />
      )}
      {step === 'review' && (
        <ReviewStep
          draft={draft} setDraft={setDraft} saving={saving} error={error}
          onSave={saveDraft} onBack={() => { setError(''); setStep(saved.length ? 'saved' : 'paste'); }}
        />
      )}
      {step === 'saved' && (
        <SavedStep sections={saved} onDelete={deleteSaved} onAddMore={() => { setError(''); setStep('paste'); }} />
      )}
      <Toast toast={toast} />
    </div>
  );
}

/* --------------------------------------------------------------- Step 1: paste */
function PasteStep({ text, setText, image, setImage, extracting, error, onExtract, onCancel }) {
  return (
    <div className="glass-card mx-auto max-w-2xl p-6">
      <h2 className="font-display text-lg font-bold text-ink">Plan next semester</h2>
      <p className="mt-1 text-sm text-muted">
        Paste your school&rsquo;s available sections — Summit will organize them. Copy the course list straight
        from your registration portal, or upload a screenshot.
      </p>

      <ErrorBanner message={error} />

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-semibold text-muted">Paste the course listing</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={'CRN   Course     Sec  Days   Time            Instructor\n10234 MATH 162   001  MWF    10:00-10:50am   Dr. Ramirez\n10235 MATH 162   002  TR     1:30-2:45pm     Dr. Chen'}
          className="field font-mono text-xs"
        />
      </label>

      <div className="mt-3">
        <span className="mb-1 block text-xs font-semibold text-muted">…or upload a screenshot (JPG / PNG)</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-soft cursor-pointer">
            {image ? 'Change image' : 'Choose image'}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => setImage(e.target.files?.[0] || null)}
            />
          </label>
          {image && (
            <span className="inline-flex items-center gap-2 text-xs text-muted">
              <span className="max-w-[12rem] truncate font-medium text-ink">{image.name}</span>
              <button type="button" onClick={() => setImage(null)} className="font-semibold text-rose-600 hover:underline">remove</button>
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onExtract} disabled={extracting || (!text.trim() && !image)} className="btn btn-primary">
          {extracting ? 'Reading your sections…' : 'Extract sections'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-soft">Cancel</button>}
        {extracting && <span className="text-xs text-muted">This can take a few seconds.</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Step 2: review */
function ReviewStep({ draft, setDraft, saving, error, onSave, onBack }) {
  const groups = useMemo(() => groupByCourse(draft), [draft]);
  const update = (id, patch) => setDraft((d) => d.map((s) => (s._id === id ? { ...s, ...patch } : s)));
  const remove = (id) => setDraft((d) => d.filter((s) => s._id !== id));
  const addSection = (code, title) => setDraft((d) => [...d, blankSection(code, title)]);
  const addCourse = () => setDraft((d) => [...d, blankSection()]);
  const flaggedCount = draft.filter((s) => (s.issues && s.issues.length) || !s.courseCode).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Review the sections</h2>
          <p className="text-sm text-muted">
            Summit read {draft.length} section{draft.length === 1 ? '' : 's'}. Fix anything that looks off before saving.
            {flaggedCount > 0 && <span className="font-semibold text-amber-600"> {flaggedCount} need a look.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="btn btn-soft">Back</button>
          <button type="button" onClick={onSave} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Looks right — save these sections'}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key} className="glass-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-ink">
                {g.code || 'New course'}
                {g.title && <span className="ml-2 font-medium text-muted">{g.title}</span>}
              </h3>
              <button type="button" onClick={() => addSection(g.code, g.title)} className="text-xs font-semibold text-brand-600 hover:underline">
                + Add section
              </button>
            </div>
            <div className="space-y-2">
              {g.items.map((s) => (
                <SectionRow key={s._id} section={s} onChange={(patch) => update(s._id, patch)} onDelete={() => remove(s._id)} />
              ))}
            </div>
          </div>
        ))}

        <button type="button" onClick={addCourse} className="btn btn-soft w-full">+ Add a course extraction missed</button>
      </div>
    </div>
  );
}

/** One editable section row (mobile-friendly: fields wrap). */
function SectionRow({ section, onChange, onDelete }) {
  const flagged = (section.issues && section.issues.length) || !section.courseCode;
  return (
    <div className={`rounded-xl border bg-white/50 p-3 ${flagged ? 'border-amber-400/70' : 'border-white/50'}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <Field className="sm:col-span-3" label="Course" value={section.courseCode} onChange={(v) => onChange({ courseCode: v })} placeholder="MATH 162" />
        <Field className="sm:col-span-3" label="Title" value={section.courseTitle} onChange={(v) => onChange({ courseTitle: v })} placeholder="Calculus II" />
        <Field className="sm:col-span-2" label="Section" value={section.sectionNumber} onChange={(v) => onChange({ sectionNumber: v })} placeholder="001" />
        <div className="sm:col-span-4">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Days</span>
          <DaysPicker value={section.days || []} onChange={(days) => onChange({ days })} />
        </div>
        <TimeField className="sm:col-span-2" label="Start" value={section.startTime} onChange={(v) => onChange({ startTime: v })} />
        <TimeField className="sm:col-span-2" label="End" value={section.endTime} onChange={(v) => onChange({ endTime: v })} />
        <Field className="sm:col-span-4" label="Professor" value={section.professor} onChange={(v) => onChange({ professor: v })} placeholder="Dr. Ramirez" />
        <Field className="sm:col-span-3" label="Location" value={section.location} onChange={(v) => onChange({ location: v })} placeholder="Halligan 102" />
        <div className="flex items-end justify-end sm:col-span-1">
          <button type="button" onClick={onDelete} aria-label="Delete section" className="rounded-lg px-2 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50">×</button>
        </div>
      </div>
      {flagged && (
        <p className="mt-1.5 text-[11px] font-medium text-amber-600">
          {section.issues?.length ? `Check the ${section.issues.join(' and ')}.` : 'Add a course code so this section can be grouped.'}
        </p>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="field !py-1.5 text-sm" />
    </label>
  );
}
function TimeField({ label, value, onChange, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <input type="time" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="field !py-1.5 text-sm" />
    </label>
  );
}
function DaysPicker({ value, onChange }) {
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...WEEKDAYS].filter((x) => value.includes(x) || x === d));
  return (
    <div className="flex flex-wrap gap-1">
      {WEEKDAYS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => toggle(d)}
          className={`h-7 w-8 rounded-md text-[11px] font-bold transition ${
            value.includes(d) ? 'text-white shadow-sm' : 'border border-white/60 bg-white/60 text-muted hover:text-ink'
          }`}
          style={value.includes(d) ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
        >
          {d[0]}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- Step 3: saved */
function SavedStep({ sections, onDelete, onAddMore }) {
  const groups = useMemo(() => groupByCourse(sections), [sections]);
  const fmt = (s) => {
    const t = s.startTime ? `${s.startTime}${s.endTime ? `–${s.endTime}` : ''}` : null;
    return [(s.days || []).join(' '), t, s.location].filter(Boolean).join(' · ');
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Your saved sections</h2>
          <p className="text-sm text-muted">{sections.length} section{sections.length === 1 ? '' : 's'} across {groups.length} course{groups.length === 1 ? '' : 's'}.</p>
        </div>
        <button type="button" onClick={onAddMore} className="btn btn-primary">Paste more courses</button>
      </div>

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key} className="glass-card p-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-bold text-ink">
                {g.code || 'Untitled course'}
                {g.title && <span className="ml-2 font-medium text-muted">{g.title}</span>}
              </h3>
              <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700">
                {g.items.length} section{g.items.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="space-y-1.5">
              {g.items.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/50 bg-white/40 px-3 py-2">
                  <span className="min-w-0">
                    <span className="text-sm font-semibold text-ink">Section {s.sectionNumber || '—'}</span>
                    <span className="ml-2 text-xs text-muted">{fmt(s) || 'No meeting time'}{s.professor ? ` · ${s.professor}` : ''}</span>
                  </span>
                  <button type="button" onClick={() => onDelete(s.id)} aria-label="Remove section" className="shrink-0 rounded px-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50">×</button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Empty slot where Stage B (the schedule solver) will go. */}
      <div className="glass-card mt-5 border-dashed p-6 text-center">
        <p className="text-sm font-semibold text-ink">Next: Summit will find every schedule that works.</p>
        <p className="mt-1 text-xs text-muted">Coming soon — we&rsquo;ll build conflict-free schedules from these sections.</p>
      </div>
    </div>
  );
}
