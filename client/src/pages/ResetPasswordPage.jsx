import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { ErrorBanner } from '../components/ui';
import { MountainMark } from '../components/MountainMark';

/**
 * Rate a password 0–4 for the strength meter. Cheap heuristic (length + variety)
 * — the backend enforces the real minimum (8 chars).
 */
function scorePassword(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH = [
  { label: 'Too short', color: '#f43f5e' },
  { label: 'Weak', color: '#f97316' },
  { label: 'Fair', color: '#eab308' },
  { label: 'Good', color: '#14b8a6' },
  { label: 'Strong', color: '#10b981' },
];

function StrengthMeter({ password }) {
  const score = scorePassword(password);
  if (!password) return null;
  const { label, color } = STRENGTH[score];
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ backgroundColor: i < Math.max(score, 1) ? color : 'rgba(148,163,184,0.3)' }}
          />
        ))}
      </div>
      <p className="text-xs font-medium" style={{ color }}>
        {label}
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { resetPassword } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const canSubmit = useMemo(
    () => password.length >= 8 && password === confirm && !submitting,
    [password, confirm, submitting],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      // Success → back to login with a friendly notice.
      navigate('/login', {
        replace: true,
        state: { notice: 'Password reset! Please log in.' },
      });
    } catch (err) {
      setError(
        errorMessage(err, 'Invalid or expired token. Please request a new reset link.'),
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div
        className="animate-float pointer-events-none absolute left-[14%] top-[20%] h-44 w-44 rounded-full opacity-40 blur-3xl"
        style={{ backgroundImage: 'var(--grad-teal-purple)' }}
      />
      <div
        className="animate-float pointer-events-none absolute bottom-[18%] right-[16%] h-52 w-52 rounded-full opacity-40 blur-3xl"
        style={{ backgroundImage: 'var(--grad-pink-lavender)', animationDelay: '2s' }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="relative mx-auto h-16 w-16">
            <span
              className="absolute inset-0 rounded-full opacity-55 blur-2xl"
              style={{ backgroundImage: 'var(--grad-teal-purple)' }}
            />
            <MountainMark size={64} className="relative drop-shadow-[0_8px_18px_rgba(255,120,80,0.35)]" />
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-gradient">
            Choose a new password
          </h1>
          <p className="mt-1 text-sm text-muted">Almost there — pick something you'll remember.</p>
        </div>

        <form onSubmit={handleSubmit} className="glass-panel space-y-4 p-6">
          <ErrorBanner message={error} />

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              autoFocus
              required
              className="field"
            />
            <div className="mt-2">
              <StrengthMeter password={password} />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              required
              className="field"
            />
            {mismatch && <p className="mt-1 text-xs font-medium text-rose-deep">Passwords don't match.</p>}
            {tooShort && !mismatch && (
              <p className="mt-1 text-xs font-medium text-muted">Use at least 8 characters.</p>
            )}
          </label>

          <button type="submit" disabled={!canSubmit} className="btn btn-primary w-full">
            {submitting ? 'Resetting…' : 'Reset password'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full text-center text-sm font-semibold text-muted hover:text-ink"
          >
            ← Back to sign in
          </button>
        </form>
      </div>
    </div>
  );
}
