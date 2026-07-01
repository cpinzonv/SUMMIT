import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { ErrorBanner } from '../components/ui';
import { MountainMark } from '../components/MountainMark';
import { SocialAuthButtons } from '../components/SocialAuthButtons';
import { ForgotPasswordModal } from '../components/ForgotPasswordModal';

// Show the "Forgot password?" link and start a cooldown once a user has fumbled
// their password this many times, to nudge them toward recovery and slow
// brute-force guessing from the UI.
const ATTEMPTS_BEFORE_HELP = 3;
const COOLDOWN_SECONDS = 15;

export default function LoginPage() {
  const { user, login, completeTwoFactor, register, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({
    email: 'demo@student.app',
    password: 'password123',
    fullName: '',
    referralSource: '',
    referralSourceDetail: '',
  });
  // An OAuth attempt that failed bounces back to /login with a message in state.
  const [error, setError] = useState(location.state?.oauthError || '');
  // A completed password reset redirects here with a friendly notice.
  const [notice, setNotice] = useState(location.state?.notice || '');
  const [submitting, setSubmitting] = useState(false);
  const [twoFactor, setTwoFactor] = useState(null); // { challengeToken } when 2FA prompt is shown
  const [code, setCode] = useState('');

  // Failed-login tracking → surfaces the "Forgot password?" affordance and a
  // short cooldown after repeated misses.
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [showForgot, setShowForgot] = useState(false);
  const showForgotLink = failedAttempts >= ATTEMPTS_BEFORE_HELP;

  // Tick the cooldown down to zero once armed.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Already authenticated → skip the form.
  if (!loading && user) return <Navigate to={from} replace />;

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const res = await login(form.email, form.password);
        if (res?.twoFactorRequired) {
          setTwoFactor({ challengeToken: res.challengeToken });
          setSubmitting(false);
          return; // show the 2FA code step instead of navigating
        }
        setFailedAttempts(0); // success clears the counter
      } else {
        await register({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          ...(form.referralSource ? { referralSource: form.referralSource } : {}),
          ...(form.referralSource === 'other' && form.referralSourceDetail
            ? { referralSourceDetail: form.referralSourceDetail }
            : {}),
        });
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Authentication failed'));
      // Count login failures only (not registration) and arm a cooldown once
      // the user has crossed the help threshold.
      if (mode === 'login') {
        setFailedAttempts((n) => {
          const next = n + 1;
          if (next >= ATTEMPTS_BEFORE_HELP) setCooldown(COOLDOWN_SECONDS);
          return next;
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const verifyTwoFactor = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await completeTwoFactor(twoFactor.challengeToken, code.trim());
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Verification failed'));
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

        {twoFactor ? (
          <form onSubmit={verifyTwoFactor} className="glass-panel space-y-4 p-6">
            <div>
              <h2 className="text-lg font-bold text-ink">Two-factor authentication</h2>
              <p className="mt-0.5 text-sm text-muted">Enter the 6-digit code from your authenticator app, or a backup code.</p>
            </div>
            <ErrorBanner message={error} />
            <Field
              label="Authentication code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              required
            />
            <button type="submit" disabled={submitting || !code.trim()} className="btn btn-primary w-full">
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setTwoFactor(null); setCode(''); setError(''); }}
              className="w-full text-center text-sm font-semibold text-muted hover:text-ink"
            >
              ← Back to sign in
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="glass-panel space-y-4 p-6">
          {notice && (
            <div className="rounded-2xl border border-teal-500/40 bg-teal-500/10 px-4 py-3 text-sm font-medium text-teal-700 backdrop-blur">
              {notice}
            </div>
          )}
          <ErrorBanner message={error} />

          {mode === 'login' && showForgotLink && (
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="-mt-1 self-start text-sm font-semibold text-brand-600 hover:underline"
            >
              Forgot password?
            </button>
          )}

          <SocialAuthButtons />

          {mode === 'register' && (
            <Field label="Full name" value={form.fullName} onChange={update('fullName')} required />
          )}
          <Field label="Email" type="email" value={form.email} onChange={update('email')} required />
          <Field label="Password" type="password" value={form.password} onChange={update('password')} required />

          {mode === 'register' && (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink">How'd you hear about us?</span>
                <select value={form.referralSource} onChange={update('referralSource')} className="field">
                  <option value="">Select one (optional)</option>
                  <option value="friend">Friend / Referral</option>
                  <option value="google_search">Google Search</option>
                  <option value="social_media">Social Media</option>
                  <option value="school">School / Campus</option>
                  <option value="app_store">App Store</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {form.referralSource === 'other' && (
                <Field
                  label="Tell us more"
                  value={form.referralSourceDetail}
                  onChange={update('referralSourceDetail')}
                  placeholder="Where did you find Summit?"
                  maxLength={200}
                />
              )}
            </>
          )}

          <button
            type="submit"
            disabled={submitting || (mode === 'login' && cooldown > 0)}
            className="btn btn-primary w-full"
          >
            {submitting
              ? 'Please wait…'
              : mode === 'login' && cooldown > 0
                ? `Try again in ${cooldown}s`
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
                setNotice('');
              }}
              className="font-semibold text-brand-600 hover:underline"
            >
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </form>
        )}

        <p className="mt-4 text-center text-xs text-muted">
          Demo: demo@student.app / password123
        </p>
      </div>

      {showForgot && (
        <ForgotPasswordModal
          initialEmail={form.email}
          onClose={() => setShowForgot(false)}
        />
      )}
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
