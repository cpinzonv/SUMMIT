import { useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ErrorBanner } from './ui';

/**
 * Degree Requirements — Stage R1 editor. Upload a requirements sheet (photo, PDF,
 * or pasted text) → AI extracts the structure → the student reviews/corrects it
 * in an editable table → save. Editing an existing program pre-fills the table;
 * uploading another sheet APPENDS its categories to the table (a client-side
 * merge), and saving persists the whole table (server does a full replace).
 *
 * Mirrors the Semester Schedule Builder's review-table UX (grouped, dense,
 * mobile-friendly). Extraction is metered + server-side; no AI here.
 */

const TERMS = ['Fall', 'Spring', 'Summer'];
const rid = () => Math.random().toString(36).slice(2);

const blankCourse = () => ({ _id: rid(), courseCode: '', courseTitle: '', credits: '', offeredTerms: null, prereqGroups: [] });
const blankCategory = () => ({ _id: rid(), name: '', creditsRequired: '', notes: '', courses: [] });

const withIds = (categories = []) =>
  categories.map((c) => ({
    _id: rid(),
    name: c.name || '',
    creditsRequired: c.creditsRequired ?? '',
    notes: c.notes || '',
    issues: c.issues,
    courses: (c.courses || []).map((co) => ({
      _id: rid(),
      courseCode: co.courseCode || '',
      courseTitle: co.courseTitle || '',
      credits: co.credits ?? '',
      offeredTerms: co.offeredTerms ?? null,
      prereqGroups: co.prereqGroups || [],
      issues: co.issues,
    })),
  }));

const prereqGroupsToText = (groups) => (groups || []).map((g) => g.join(' or ')).join('; ');
const textToPrereqGroups = (text) =>
  String(text || '')
    .split(';')
    .map((s) => s.split(/\s+or\s+/i).map((t) => t.trim()).filter(Boolean))
    .filter((g) => g.length);

export function RequirementsEditor({ initial, onSaved, onClose }) {
  const existing = withIds(initial?.categories);
  const [program, setProgram] = useState({
    name: initial?.program?.name || '',
    totalCredits: initial?.program?.totalCredits ?? '',
  });
  const [categories, setCategories] = useState(existing);
  // Start on the review table when we already have categories to edit.
  const [step, setStep] = useState(existing.length ? 'review' : 'upload');

  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const runExtract = async () => {
    if (!text.trim() && !file) { setError('Paste your requirements or add a photo/PDF first.'); return; }
    setExtracting(true); setError('');
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('text', text);
      if (file) fd.append('file', file);
      const { data } = await api.post('/api/requirements/extract', fd);
      const extracted = withIds(data.categories);
      if (!extracted.length && !data.program?.name) {
        setError("Couldn't find any requirements in that. Try pasting the text directly.");
        return;
      }
      // First upload adopts the program name/total; a later sheet only fills blanks.
      setProgram((p) => ({
        name: p.name || data.program?.name || '',
        totalCredits: p.totalCredits !== '' && p.totalCredits != null ? p.totalCredits : data.program?.totalCredits ?? '',
      }));
      setCategories((cur) => [...cur, ...extracted]); // append (merge)
      setText(''); setFile(null);
      setStep('review');
    } catch (err) {
      // Preserve the raw input so nothing is lost on a failed extraction.
      setError(errorMessage(err, "Couldn't read that — try pasting the text directly."));
    } finally {
      setExtracting(false);
    }
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = {
        program: { name: program.name || null, totalCredits: program.totalCredits === '' ? null : program.totalCredits },
        categories: categories.map((c) => ({
          name: c.name || null,
          creditsRequired: c.creditsRequired === '' ? null : c.creditsRequired,
          notes: c.notes || null,
          courses: (c.courses || []).map((co) => ({
            courseCode: co.courseCode || null,
            courseTitle: co.courseTitle || null,
            credits: co.credits === '' ? null : co.credits,
            offeredTerms: co.offeredTerms,
            prereqGroups: co.prereqGroups || [],
          })),
        })),
      };
      const { data } = await api.put('/api/requirements', payload);
      onSaved?.(data);
    } catch (err) {
      setError(errorMessage(err, 'Could not save your requirements.'));
    } finally {
      setSaving(false);
    }
  };

  if (step === 'upload') {
    return (
      <UploadStep
        text={text} setText={setText} file={file} setFile={setFile}
        extracting={extracting} error={error} onExtract={runExtract}
        onCancel={onClose}
      />
    );
  }

  return (
    <ReviewStep
      program={program} setProgram={setProgram}
      categories={categories} setCategories={setCategories}
      saving={saving} error={error} onSave={save}
      onUploadMore={() => { setError(''); setStep('upload'); }}
      onCancel={onClose}
    />
  );
}

/* --------------------------------------------------------------- upload step */
function UploadStep({ text, setText, file, setFile, extracting, error, onExtract, onCancel }) {
  return (
    <div className="glass-card mx-auto max-w-2xl p-6">
      <h2 className="font-display text-lg font-bold text-ink">Add your degree requirements</h2>
      <p className="mt-1 text-sm text-muted">
        Paste your requirements sheet, or upload a photo or PDF of it — Summit will organize it into categories and track
        your progress. Copy straight from your advising portal or degree audit.
      </p>

      <ErrorBanner message={error} />

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-semibold text-muted">Paste the requirements</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={'B.S. Computer Science — 120 credits\n\nCore CS (30 cr)\nCS 101 Intro to CS  4 cr  (Fall, Spring)\nCS 201 Data Structures  4 cr  prereq: CS 101\n…'}
          className="field font-mono text-xs"
        />
      </label>

      <div className="mt-3">
        <span className="mb-1 block text-xs font-semibold text-muted">…or upload a photo or PDF</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-soft cursor-pointer">
            {file ? 'Change file' : 'Choose file'}
            <input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          {file && (
            <span className="inline-flex items-center gap-2 text-xs text-muted">
              <span className="max-w-[14rem] truncate font-medium text-ink">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} className="font-semibold text-rose-600 hover:underline">remove</button>
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onExtract} disabled={extracting || (!text.trim() && !file)} className="btn btn-primary">
          {extracting ? 'Reading your requirements…' : 'Extract requirements'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-soft">Cancel</button>}
        {extracting && <span className="text-xs text-muted">This can take a few seconds.</span>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- review step */
function ReviewStep({ program, setProgram, categories, setCategories, saving, error, onSave, onUploadMore, onCancel }) {
  const flagged = useMemo(
    () => categories.reduce((n, c) => n + (c.issues?.length ? 1 : 0) + (c.courses || []).filter((co) => co.issues?.length).length, 0),
    [categories],
  );

  const updateCat = (id, patch) => setCategories((cs) => cs.map((c) => (c._id === id ? { ...c, ...patch } : c)));
  const removeCat = (id) => setCategories((cs) => cs.filter((c) => c._id !== id));
  const addCat = () => setCategories((cs) => [...cs, blankCategory()]);
  const addCourse = (catId) => setCategories((cs) => cs.map((c) => (c._id === catId ? { ...c, courses: [...c.courses, blankCourse()] } : c)));
  const updateCourse = (catId, coId, patch) =>
    setCategories((cs) => cs.map((c) => (c._id === catId ? { ...c, courses: c.courses.map((co) => (co._id === coId ? { ...co, ...patch } : co)) } : c)));
  const removeCourse = (catId, coId) =>
    setCategories((cs) => cs.map((c) => (c._id === catId ? { ...c, courses: c.courses.filter((co) => co._id !== coId) } : c)));

  const totalCourses = categories.reduce((n, c) => n + (c.courses?.length || 0), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Review your requirements</h2>
          <p className="text-sm text-muted">
            {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {totalCourses} course{totalCourses === 1 ? '' : 's'}. Fix anything that looks off before saving.
            {flagged > 0 && <span className="font-semibold text-amber-600"> {flagged} need a look.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onCancel && <button type="button" onClick={onCancel} className="btn btn-soft">Cancel</button>}
          <button type="button" onClick={onUploadMore} className="btn btn-soft">Upload another sheet</button>
          <button type="button" onClick={onSave} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Looks right — save my requirements'}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="glass-card mb-5 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field className="sm:col-span-2" label="Degree program" value={program.name} onChange={(v) => setProgram((p) => ({ ...p, name: v }))} placeholder="B.S. Computer Science" />
          <Field label="Total credits" type="number" value={program.totalCredits} onChange={(v) => setProgram((p) => ({ ...p, totalCredits: v }))} placeholder="120" />
        </div>
      </div>

      <div className="space-y-5">
        {categories.map((c) => (
          <div key={c._id} className={`glass-card p-4 ${c.issues?.length ? 'ring-1 ring-amber-400/60' : ''}`}>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12">
              <Field className="sm:col-span-5" label="Category" value={c.name} onChange={(v) => updateCat(c._id, { name: v })} placeholder="Core Computer Science" />
              <Field className="sm:col-span-2" label="Credits req." type="number" value={c.creditsRequired} onChange={(v) => updateCat(c._id, { creditsRequired: v })} placeholder="30" />
              <Field className="sm:col-span-4" label="Notes" value={c.notes} onChange={(v) => updateCat(c._id, { notes: v })} placeholder="9 credits from any 300-level HIST" />
              <div className="flex items-end justify-end sm:col-span-1">
                <button type="button" onClick={() => removeCat(c._id)} aria-label="Delete category" className="rounded-lg px-2 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50">×</button>
              </div>
            </div>

            <div className="space-y-2">
              {c.courses.map((co) => (
                <CourseRow key={co._id} course={co} onChange={(patch) => updateCourse(c._id, co._id, patch)} onDelete={() => removeCourse(c._id, co._id)} />
              ))}
            </div>
            <button type="button" onClick={() => addCourse(c._id)} className="mt-2 text-xs font-semibold text-brand-600 hover:underline">+ Add course</button>
          </div>
        ))}

        <button type="button" onClick={addCat} className="btn btn-soft w-full">+ Add a category</button>
      </div>
    </div>
  );
}

/** One editable requirement course (mobile-friendly: fields wrap). */
function CourseRow({ course, onChange, onDelete }) {
  const flagged = course.issues?.length;
  return (
    <div className={`rounded-xl border bg-white/50 p-3 ${flagged ? 'border-amber-400/70' : 'border-white/50'}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <Field className="sm:col-span-2" label="Code" value={course.courseCode} onChange={(v) => onChange({ courseCode: v })} placeholder="MATH 162" />
        <Field className="sm:col-span-4" label="Title" value={course.courseTitle} onChange={(v) => onChange({ courseTitle: v })} placeholder="Calculus II" />
        <Field className="sm:col-span-1" label="Cr" type="number" value={course.credits} onChange={(v) => onChange({ credits: v })} placeholder="4" />
        <div className="sm:col-span-2">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Offered</span>
          <TermsPicker value={course.offeredTerms} onChange={(offeredTerms) => onChange({ offeredTerms })} />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Prereqs</span>
          <input
            value={prereqGroupsToText(course.prereqGroups)}
            onChange={(e) => onChange({ prereqGroups: textToPrereqGroups(e.target.value) })}
            placeholder="MATH 161 or placement; CHEM 101"
            title="Separate required groups with ';', alternatives within a group with 'or'"
            className="field !py-1.5 text-sm"
          />
        </div>
        <div className="flex items-end justify-end sm:col-span-1">
          <button type="button" onClick={onDelete} aria-label="Delete course" className="rounded-lg px-2 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50">×</button>
        </div>
      </div>
      {flagged && <p className="mt-1.5 text-[11px] font-medium text-amber-600">Check the {course.issues.join(' and ')}.</p>}
    </div>
  );
}

/** Fall/Spring/Summer with an explicit "unknown" (Not stated) state. */
function TermsPicker({ value, onChange }) {
  const known = Array.isArray(value);
  const toggle = (t) => {
    const cur = known ? value : [];
    onChange(cur.includes(t) ? cur.filter((x) => x !== t) : TERMS.filter((x) => cur.includes(x) || x === t));
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TERMS.map((t) => {
        const on = known && value.includes(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            className={`h-7 w-7 rounded-md text-[11px] font-bold transition ${on ? 'text-white shadow-sm' : 'border border-white/60 bg-white/60 text-muted hover:text-ink'}`}
            style={on ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
            title={t}
          >
            {t[0]}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(known ? null : [])}
        className={`h-7 rounded-md px-1.5 text-[10px] font-semibold transition ${known ? 'border border-white/60 bg-white/60 text-muted hover:text-ink' : 'bg-amber-100 text-amber-700'}`}
        title={known ? 'Mark offered terms as not stated' : 'Offered terms not stated on the sheet'}
      >
        {known ? 'clear' : 'Not stated'}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="field !py-1.5 text-sm" />
    </label>
  );
}
