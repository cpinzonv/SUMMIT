import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { ErrorBanner } from '../components/ui';

export default function CreateClassPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    code: '',
    term: '',
    description: '',
    startDate: '',
    endDate: '',
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
      const { data } = await api.post('/api/classes', {
        name: form.name,
        code: form.code || undefined,
        term: form.term || undefined,
        description: form.description || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      });
      navigate(`/classes/${data.class.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/" className="text-sm text-brand-600 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mb-6 mt-3 text-2xl font-bold">New class</h1>

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
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" type="date" value={form.startDate} onChange={update('startDate')} />
          <Field label="End date" type="date" value={form.endDate} onChange={update('endDate')} />
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Description
          </span>
          <textarea
            value={form.description}
            onChange={update('description')}
            rows={3}
            placeholder="Course description or notes…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving || !form.name}
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create class'}
          </button>
          <Link
            to="/"
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
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
