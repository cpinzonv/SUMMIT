import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { ErrorBanner } from '../components/ui';
import { MountainMark } from '../components/MountainMark';

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
      {/* Floating dreamy blobs */}
      <div
        className="animate-float pointer-events-none absolute left-[12%] top-[18%] h-44 w-44 rounded-full opacity-40 blur-3xl"
        style={{ backgroundImage: 'var(--grad-teal-purple)' }}
      />
      <div
        className="animate-float pointer-events-none absolute bottom-[16%] right-[14%] h-52 w-52 rounded-full opacity-40 blur-3xl"
        style={{ backgroundImage: 'var(--grad-pink-lavender)', animationDelay: '2s' }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="relative mx-auto h-16 w-16">
            <span
              className="absolute inset-0 rounded-full opacity-55 blur-2xl"
              style={{ backgroundImage: 'var(--grad-teal-purple)' }}
            />
            <MountainMark
              size={64}
              className="relative drop-shadow-[0_8px_18px_rgba(255,120,80,0.35)]"
            />
          </div>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-gradient">
            Summit
          </h1>
          <p className="mt-1 text-sm font-medium text-muted">
            Reach your summit, one semester at a time
          </p>
          <p className="mt-3 text-sm text-muted">
            {mode === 'login' ? 'Welcome back — sign in to keep climbing' : 'Create your account and start the climb'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="glass-panel space-y-4 p-6">
          <ErrorBanner message={error} />

          {mode === 'register' && (
            <Field label="Full name" value={form.fullName} onChange={update('fullName')} required />
          )}
          <Field label="Email" type="email" value={form.email} onChange={update('email')} required />
          <Field label="Password" type="password" value={form.password} onChange={update('password')} required />

          <button type="submit" disabled={submitting} className="btn btn-primary w-full">
            {submitting
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>

          <p className="text-center text-sm text-muted">
            {mode === 'login' ? "Don't have an account?" : 'Already have one?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'login' ? 'register' : 'login'));
                setError('');
              }}
              className="font-semibold text-brand-600 hover:underline"
            >
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Demo: demo@student.app / password123
        </p>
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      <input {...props} className="field" />
    </label>
  );
}
