import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { ErrorBanner, Spinner } from '../components/ui';

export default function CreateClassPage() {
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [form, setForm] = useState({
    name: '',
    code: '',
    term: '',
    instructor: '',
    description: '',
    startDate: '',
    endDate: '',
  });
  // Preview rows populated from a syllabus extraction; user-editable.
  const [assignments, setAssignments] = useState([]);
  const [grading, setGrading] = useState([]);
  const [imported, setImported] = useState(false);

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // ---- Syllabus PDF extraction -------------------------------------------
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setExtractError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/api/classes/extract-syllabus', fd);
      const s = data.syllabus;
      setForm((f) => ({
        ...f,
        name: s.courseName || s.courseCode || f.name,
        code: s.courseCode || f.code,
        instructor: s.instructor || f.instructor,
        startDate: s.termStart || f.startDate,
        endDate: s.termEnd || f.endDate,
        description: s.attendanceRequired
          ? appendLine(f.description, 'Attendance is required.')
          : f.description,
      }));
      setAssignments(
        (s.assignments || []).map((a) => ({
          name: a.name || '',
          dueDate: a.dueDate || '',
          pointValue: a.pointValue ?? '',
        })),
      );
      setGrading(
        Object.entries(s.gradingBreakdown || {}).map(([category, weight]) => ({
          category,
          weight,
        })),
      );
      setImported(true);
    } catch (err) {
      setExtractError(errorMessage(err, 'Could not extract the syllabus.'));
    } finally {
      setExtracting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // ---- Assignment / grading row editing ----------------------------------
  const setAssignment = (i, field, value) =>
    setAssignments((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)),
    );
  const removeAssignment = (i) =>
    setAssignments((rows) => rows.filter((_, idx) => idx !== i));
  const addAssignment = () =>
    setAssignments((rows) => [...rows, { name: '', dueDate: '', pointValue: '' }]);

  const setGradingRow = (i, field, value) =>
    setGrading((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)),
    );
  const removeGradingRow = (i) =>
    setGrading((rows) => rows.filter((_, idx) => idx !== i));
  const addGradingRow = () =>
    setGrading((rows) => [...rows, { category: '', weight: '' }]);

  const gradingTotal = grading.reduce(
    (sum, g) => sum + (Number(g.weight) || 0),
    0,
  );

  // ---- Create -------------------------------------------------------------
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/api/classes', {
        name: form.name,
        code: form.code || undefined,
        term: form.term || undefined,
        description: form.description || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        syllabus: {
          instructor: form.instructor || undefined,
          gradingScheme: grading
            .filter((g) => g.category && g.weight !== '')
            .map((g) => ({ name: g.category, weight: Number(g.weight) / 100 })),
        },
      });
      const classId = data.class.id;

      // Create each extracted assignment.
      for (const a of assignments.filter((a) => a.name.trim())) {
        await api.post(`/api/classes/${classId}/assignments`, {
          title: a.name.trim(),
          dueDate: a.dueDate
            ? new Date(`${a.dueDate}T00:00:00`).toISOString()
            : undefined,
          pointValue: a.pointValue === '' ? undefined : Number(a.pointValue),
        });
      }

      navigate(`/classes/${classId}`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/" className="text-sm text-brand-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mb-6 mt-3 text-2xl font-bold">New class</h1>

      {/* Syllabus import */}
      <div className="mb-6 rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-brand-800">
              📄 Import from syllabus
            </h2>
            <p className="text-sm text-slate-600">
              Upload a syllabus PDF and Claude will fill in the details below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={extracting}
            className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {extracting ? 'Reading…' : 'Upload PDF'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            onChange={handleFile}
            className="hidden"
          />
        </div>
        {extracting && <Spinner label="Extracting syllabus with Claude…" />}
        <ErrorBanner message={extractError} />
        {imported && !extracting && (
          <p className="mt-3 text-sm text-emerald-700">
            ✓ Extracted — review and edit everything below, then create the class.
          </p>
        )}
      </div>

      <form
        onSubmit={submit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <ErrorBanner message={error} />

        <Field label="Class name" value={form.name} onChange={update('name')} required placeholder="Introduction to Computer Science" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code" value={form.code} onChange={update('code')} placeholder="CS 101" />
          <Field label="Term" value={form.term} onChange={update('term')} placeholder="Fall 2026" />
        </div>
        <Field label="Instructor" value={form.instructor} onChange={update('instructor')} placeholder="Dr. Ada Lovelace" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" type="date" value={form.startDate} onChange={update('startDate')} />
          <Field label="End date" type="date" value={form.endDate} onChange={update('endDate')} />
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
          <textarea
            value={form.description}
            onChange={update('description')}
            rows={2}
            placeholder="Course description or notes…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>

        {/* Grading breakdown */}
        {(grading.length > 0 || imported) && (
          <section className="rounded-xl border border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                Grading breakdown{' '}
                <span className={gradingTotal === 100 ? 'text-emerald-600' : 'text-amber-600'}>
                  ({gradingTotal}%)
                </span>
              </h3>
              <button type="button" onClick={addGradingRow} className="text-xs font-medium text-brand-600 hover:underline">
                + Add category
              </button>
            </div>
            <div className="space-y-2">
              {grading.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={g.category}
                    onChange={(e) => setGradingRow(i, 'category', e.target.value)}
                    placeholder="Category"
                    className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <input
                    type="number"
                    value={g.weight}
                    onChange={(e) => setGradingRow(i, 'weight', e.target.value)}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <span className="text-sm text-slate-400">%</span>
                  <button type="button" onClick={() => removeGradingRow(i)} className="text-xs text-slate-400 hover:text-red-600">✕</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Assignments preview */}
        {(assignments.length > 0 || imported) && (
          <section className="rounded-xl border border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                Assignments ({assignments.filter((a) => a.name.trim()).length})
              </h3>
              <button type="button" onClick={addAssignment} className="text-xs font-medium text-brand-600 hover:underline">
                + Add assignment
              </button>
            </div>
            <div className="space-y-2">
              {assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.name}
                    onChange={(e) => setAssignment(i, 'name', e.target.value)}
                    placeholder="Assignment name"
                    className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <input
                    type="date"
                    value={a.dueDate}
                    onChange={(e) => setAssignment(i, 'dueDate', e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                  <input
                    type="number"
                    value={a.pointValue}
                    onChange={(e) => setAssignment(i, 'pointValue', e.target.value)}
                    placeholder="pts"
                    className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <button type="button" onClick={() => removeAssignment(i)} className="text-xs text-slate-400 hover:text-red-600">✕</button>
                </div>
              ))}
              {assignments.length === 0 && (
                <p className="text-sm text-slate-400">No assignments — add some or import a syllabus.</p>
              )}
            </div>
          </section>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving || !form.name}
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create class'}
          </button>
          <Link to="/" className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function appendLine(existing, line) {
  return existing ? `${existing}\n${line}` : line;
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}
