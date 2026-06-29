import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { ErrorBanner } from '../components/ui';

export default function LoginPage() {
  const { user, login, register, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ email: 'demo@student.app', password: 'password123', fullName: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated → skip the form.
  if (!loading && user) return <Navigate to={from} replace />;

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
        });
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Authentication failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">🎓</div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            Student Workflow
          </h1>
          <p className="text-sm text-slate-500">
            {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <ErrorBanner message={error} />

          {mode === 'register' && (
            <Field
              label="Full name"
              value={form.fullName}
              onChange={update('fullName')}
              required
            />
          )}
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={update('email')}
            required
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={update('password')}
            required
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>

          <p className="text-center text-sm text-slate-500">
            {mode === 'login' ? "Don't have an account?" : 'Already have one?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'login' ? 'register' : 'login'));
                setError('');
              }}
              className="font-medium text-brand-600 hover:underline"
            >
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Demo: demo@student.app / password123
        </p>
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}
