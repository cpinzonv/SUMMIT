import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { ErrorBanner, Spinner, Toggle } from '../components/ui';

const ROW_INPUT =
  'rounded-lg border border-white/70 bg-white/60 px-2.5 py-1.5 text-sm text-ink outline-none backdrop-blur transition focus:border-brand-400 focus:bg-white/85';

const MEETING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

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
  // Meeting schedule → drives auto-generated attendance sessions.
  const [meetingDays, setMeetingDays] = useState([]);
  const [meetingTime, setMeetingTime] = useState('');
  const [attendanceGraded, setAttendanceGraded] = useState(false);
  const [attendanceWeight, setAttendanceWeight] = useState('');

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

  const toggleDay = (d) =>
    setMeetingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

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
      setAttendanceGraded(Boolean(s.attendanceGraded));
      setAttendanceWeight(s.attendanceWeight != null ? String(s.attendanceWeight) : '');
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
        meetingDays: meetingDays.length ? meetingDays : undefined,
        meetingTime: meetingTime || undefined,
        attendanceGraded: attendanceGraded || undefined,
        attendanceWeight:
          attendanceGraded && attendanceWeight !== '' ? Number(attendanceWeight) : undefined,
        syllabus: {
          instructor: form.instructor || undefined,
          gradingScheme: grading
            .filter((g) => g.category && g.weight !== '')
            .map((g) => ({ name: g.category, weight: Number(g.weight) / 100 })),
        },
      });
      const classId = data.class.id;

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
      <Link to="/" className="text-sm font-semibold text-brand-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mb-6 mt-3 text-3xl font-extrabold tracking-tight">New class</h1>

      {/* Syllabus import */}
      <div
        className="glass-card relative mb-6 overflow-hidden p-5"
        style={{ background: 'rgba(255,255,255,0.45)' }}
      >
        <span
          className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full opacity-40 blur-2xl"
          style={{ backgroundImage: 'var(--grad-pink-lavender)' }}
        />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <h2 className="font-bold text-ink">Import from syllabus</h2>
            <p className="text-sm text-muted">
              Upload a syllabus PDF and Claude will fill in the details below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={extracting}
            className="btn btn-primary shrink-0"
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
          <p className="relative mt-3 text-sm font-medium text-emerald-600">
            ✓ Extracted — review and edit everything below, then create the class.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="glass-panel space-y-4 p-6">
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

        {/* Meeting schedule → auto-generates attendance sessions */}
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-ink">Meeting days</span>
          <div className="flex flex-wrap items-center gap-2">
            {MEETING_DAYS.map((d) => {
              const on = meetingDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    on ? 'text-white shadow-sm' : 'bg-white/55 text-muted hover:bg-white/80'
                  }`}
                  style={on ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
                >
                  {d}
                </button>
              );
            })}
            <input
              type="time"
              value={meetingTime}
              onChange={(e) => setMeetingTime(e.target.value)}
              className="field ml-1 max-w-[8rem]"
              aria-label="Meeting time"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Used to auto-generate attendance sessions across the term.
          </p>
        </div>

        {/* Attendance grading */}
        <div className="rounded-2xl border border-white/60 bg-white/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-sm font-semibold text-ink">Attendance is graded</span>
              <p className="text-xs text-muted">Count attendance toward the final class grade.</p>
            </div>
            <Toggle on={attendanceGraded} onChange={() => setAttendanceGraded((v) => !v)} />
          </div>
          {attendanceGraded && (
            <label className="mt-3 block max-w-[16rem]">
              <span className="mb-1 block text-sm font-semibold text-ink">
                Attendance grade weight (%)
              </span>
              <input
                type="number"
                min="0"
                max="100"
                value={attendanceWeight}
                onChange={(e) => setAttendanceWeight(e.target.value)}
                placeholder="10"
                className="field"
              />
            </label>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Description</span>
          <textarea
            value={form.description}
            onChange={update('description')}
            rows={2}
            placeholder="Course description or notes…"
            className="field"
          />
        </label>

        {/* Grading breakdown */}
        {(grading.length > 0 || imported) && (
          <section className="rounded-2xl border border-white/60 bg-white/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">
                Grading breakdown{' '}
                <span className={gradingTotal === 100 ? 'text-emerald-500' : 'text-amber-500'}>
                  ({gradingTotal}%)
                </span>
              </h3>
              <button type="button" onClick={addGradingRow} className="text-xs font-semibold text-brand-600 hover:underline">
                + Add category
              </button>
            </div>
            <div className="space-y-2">
              {grading.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={g.category} onChange={(e) => setGradingRow(i, 'category', e.target.value)} placeholder="Category" className={`flex-1 ${ROW_INPUT}`} />
                  <input type="number" value={g.weight} onChange={(e) => setGradingRow(i, 'weight', e.target.value)} className={`w-20 ${ROW_INPUT}`} />
                  <span className="text-sm text-muted">%</span>
                  <button type="button" onClick={() => removeGradingRow(i)} className="text-xs text-muted hover:text-rose-500">✕</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Assignments preview */}
        {(assignments.length > 0 || imported) && (
          <section className="rounded-2xl border border-white/60 bg-white/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">
                Assignments ({assignments.filter((a) => a.name.trim()).length})
              </h3>
              <button type="button" onClick={addAssignment} className="text-xs font-semibold text-brand-600 hover:underline">
                + Add assignment
              </button>
            </div>
            <div className="space-y-2">
              {assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={a.name} onChange={(e) => setAssignment(i, 'name', e.target.value)} placeholder="Assignment name" className={`flex-1 ${ROW_INPUT}`} />
                  <input type="date" value={a.dueDate} onChange={(e) => setAssignment(i, 'dueDate', e.target.value)} className={`text-xs ${ROW_INPUT}`} />
                  <input type="number" value={a.pointValue} onChange={(e) => setAssignment(i, 'pointValue', e.target.value)} placeholder="pts" className={`w-16 ${ROW_INPUT}`} />
                  <button type="button" onClick={() => removeAssignment(i)} className="text-xs text-muted hover:text-rose-500">✕</button>
                </div>
              ))}
              {assignments.length === 0 && (
                <p className="text-sm text-muted">No assignments — add some or import a syllabus.</p>
              )}
            </div>
          </section>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={saving || !form.name} className="btn btn-primary">
            {saving ? 'Creating…' : 'Create class'}
          </button>
          <Link to="/" className="btn btn-soft">
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
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      <input {...props} className="field" />
    </label>
  );
}
