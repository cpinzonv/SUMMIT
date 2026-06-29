import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  Modal,
  gradeColor,
} from '../components/ui';

export default function ClassDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [cls, setCls] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Active modal: { type: 'assignment', assignment? } or { type: 'grade', assignment }
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [classesRes, assignmentsRes] = await Promise.all([
        api.get('/api/classes'),
        api.get(`/api/classes/${id}/assignments`),
      ]);
      setCls(classesRes.data.classes.find((c) => c.id === id) || null);
      setAssignments(assignmentsRes.data.assignments);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleArchive = async () => {
    if (!confirm('Archive this class? It will move to your Archives.')) return;
    try {
      await api.put(`/api/classes/${id}/archive`);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleDelete = async (assignment) => {
    if (!confirm(`Delete "${assignment.title}"? This can't be undone.`)) return;
    try {
      await api.delete(`/api/assignments/${assignment.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (loading) return <Spinner label="Loading class…" />;

  const grade = cls?.currentGrade;

  return (
    <div>
      <Link to="/" className="text-sm text-brand-600 hover:underline">
        ← Back to dashboard
      </Link>

      <div className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{cls?.name || 'Class'}</h1>
          <p className="text-sm text-slate-500">
            {[cls?.code, cls?.term].filter(Boolean).join(' · ')}
          </p>
          {cls?.description && (
            <p className="mt-2 max-w-prose text-sm text-slate-600">
              {cls.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className={`text-3xl font-bold ${gradeColor(grade?.percentage)}`}>
              {grade?.percentage != null ? `${grade.percentage}%` : '—'}
            </div>
            <div className="text-xs text-slate-400">
              Current grade {grade?.letter ? `(${grade.letter})` : ''}
            </div>
          </div>
          <button
            onClick={handleArchive}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Archive
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Assignments</h2>
          <button
            onClick={() => setModal({ type: 'assignment' })}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Add assignment
          </button>
        </div>

        {assignments.length === 0 ? (
          <EmptyState title="No assignments yet">
            Use “Add assignment” to create your first one.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Title</th>
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2">Planned</th>
                  <th className="px-4 py-2">Points</th>
                  <th className="px-4 py-2">Grade</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{a.title}</div>
                      <div className="text-xs text-slate-400">
                        {a.category || a.status?.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{fmtDate(a.dueDate)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmtDate(a.plannedDate)}</td>
                    <td className="px-4 py-2 text-slate-500">{a.pointValue ?? '—'}</td>
                    <td className="px-4 py-2">
                      {a.grade ? (
                        <button
                          onClick={() => setModal({ type: 'grade', assignment: a })}
                          className="font-medium text-slate-800 hover:text-brand-600"
                          title="Edit grade"
                        >
                          {a.grade.pointsEarned}/{a.grade.pointsPossible}
                        </button>
                      ) : (
                        <button
                          onClick={() => setModal({ type: 'grade', assignment: a })}
                          className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                        >
                          Grade
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2 text-xs">
                        <button
                          onClick={() => setModal({ type: 'assignment', assignment: a })}
                          className="font-medium text-slate-500 hover:text-brand-600"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(a)}
                          className="font-medium text-slate-500 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal?.type === 'assignment' && (
        <AssignmentModal
          classId={id}
          assignment={modal.assignment}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
      {modal?.type === 'grade' && (
        <GradeModal
          assignment={modal.assignment}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// ISO timestamp → 'YYYY-MM-DD' in local time, for date inputs.
function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// A 'YYYY-MM-DD' from a date input represents a local calendar day. Appending a
// time keeps it at local midnight so it doesn't shift across the UTC boundary.
function dateInputToISO(value) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function AssignmentModal({ classId, assignment, onClose, onSaved }) {
  const isEdit = Boolean(assignment);
  const [form, setForm] = useState({
    title: assignment?.title ?? '',
    category: assignment?.category ?? '',
    dueDate: toDateInput(assignment?.dueDate),
    plannedDate: toDateInput(assignment?.plannedDate),
    pointValue: assignment?.pointValue ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    // On edit, send explicit nulls to clear fields; on create, omit empties.
    const blank = isEdit ? null : undefined;
    const payload = {
      title: form.title,
      category: form.category || blank,
      dueDate: form.dueDate ? dateInputToISO(form.dueDate) : blank,
      plannedDate: form.plannedDate ? dateInputToISO(form.plannedDate) : blank,
      pointValue: form.pointValue === '' ? blank : Number(form.pointValue),
    };
    try {
      if (isEdit) {
        await api.patch(`/api/assignments/${assignment.id}`, payload);
      } else {
        await api.post(`/api/classes/${classId}/assignments`, payload);
      }
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit assignment' : 'Add assignment'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Input label="Title" value={form.title} onChange={update('title')} required />
        <Input label="Category" value={form.category} onChange={update('category')} placeholder="Homework, Exam…" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Due date" type="date" value={form.dueDate} onChange={update('dueDate')} />
          <Input label="Planned date" type="date" value={form.plannedDate} onChange={update('plannedDate')} />
        </div>
        <Input label="Point value" type="number" value={form.pointValue} onChange={update('pointValue')} />
        <ModalActions saving={saving} disabled={!form.title} onClose={onClose} label={isEdit ? 'Save changes' : 'Add assignment'} />
      </form>
    </Modal>
  );
}

function GradeModal({ assignment, onClose, onSaved }) {
  const existing = assignment.grade;
  const [form, setForm] = useState({
    pointsEarned: existing?.pointsEarned ?? '',
    pointsPossible:
      existing?.pointsPossible ?? assignment.pointValue ?? '',
    feedback: existing?.feedback ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/grades', {
        assignmentId: assignment.id,
        pointsEarned: Number(form.pointsEarned),
        ...(form.pointsPossible === ''
          ? {}
          : { pointsPossible: Number(form.pointsPossible) }),
        ...(form.feedback ? { feedback: form.feedback } : {}),
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${existing ? 'Edit' : 'Submit'} grade — ${assignment.title}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Points earned" type="number" value={form.pointsEarned} onChange={update('pointsEarned')} required />
          <Input label="Points possible" type="number" value={form.pointsPossible} onChange={update('pointsPossible')} placeholder={assignment.pointValue ?? '?'} />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Feedback (optional)
          </span>
          <textarea
            value={form.feedback}
            onChange={update('feedback')}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        <ModalActions saving={saving} disabled={form.pointsEarned === ''} onClose={onClose} label={existing ? 'Update grade' : 'Submit grade'} />
      </form>
    </Modal>
  );
}

function ModalActions({ saving, disabled, onClose, label }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving || disabled}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? 'Saving…' : label}
      </button>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}
