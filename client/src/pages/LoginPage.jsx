import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../api/client';
import { ErrorBanner } from '../components/ui';
import { MountainMark } from '../components/MountainMark';
import { SocialAuthButtons } from '../components/SocialAuthButtons';
import { WaitlistPanel } from '../components/WaitlistPanel';

export default function LoginPage() {
  const { user, login, completeTwoFactor, restore, register, verifyEmail, resendVerification, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  // A valid invite link (?invite=CODE) opens the signup form with the code
  // pre-applied; the server validates/consumes it (registrationGate).
  const [searchParams] = useSearchParams();
  const invite = (searchParams.get('invite') || '').trim();
  // 'open' | 'invite_only' | null (unknown → treated as closed; fail closed).
  const [registrationMode, setRegistrationMode] = useState(null);

  // Open in register mode from an invite link or the /register path; else login.
  const wantsRegister = Boolean(invite) || location.pathname === '/register';
  const [mode, setMode] = useState(wantsRegister ? 'register' : 'login'); // 'login' | 'register'
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    referralSource: '',
    referralSourceDetail: '',
  });
  // An OAuth attempt that failed bounces back to /login with a message in state.
  const [error, setError] = useState(location.state?.oauthError || '');
  const [submitting, setSubmitting] = useState(false);
  // { challengeToken } when the 2FA prompt is shown — seeded from OAuth 2FA handoff too.
  const [twoFactor, setTwoFactor] = useState(location.state?.twoFactor || null);
  // { restoreToken, deletionScheduledFor, email } for a pending-deletion account —
  // seeded from the OAuth restore handoff too.
  const [restoring, setRestoring] = useState(location.state?.restore || null);
  const [trustDevice, setTrustDevice] = useState(false); // "trust this device for 30 days"
  const [verify, setVerify] = useState(null); // { email, devCode } when email-confirmation step is shown
  const [resent, setResent] = useState('');
  const [code, setCode] = useState('');
  const [forgot, setForgot] = useState(false); // show the forgot-password panel

  // Learn whether public registration is open. Failure or unknown → invite_only
  // so the register view fails closed to the waitlist, matching the server.
  useEffect(() => {
    let alive = true;
    api
      .get('/api/auth/providers')
      .then((res) => alive && setRegistrationMode(res.data.registrationMode || 'invite_only'))
      .catch(() => alive && setRegistrationMode('invite_only'));
    return () => { alive = false; };
  }, []);

  // Register is gated to the waitlist when signup is closed and no invite link
  // is present. Login and all existing-account flows are never gated.
  const showWaitlist = mode === 'register' && !invite && registrationMode !== 'open';

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
        const res = await login(form.email, form.password);
        if (res?.twoFactorRequired) {
          setTwoFactor({ challengeToken: res.challengeToken });
          setSubmitting(false);
          return; // show the 2FA code step instead of navigating
        }
        if (res?.verificationRequired) {
          setVerify({ email: res.email, devCode: res.devCode });
          setCode('');
          setSubmitting(false);
          return; // account not yet confirmed — show the email code step
        }
        if (res?.pendingDeletion) {
          setRestoring(res);
          setSubmitting(false);
          return; // scheduled for deletion — offer to restore instead of signing in
        }
      } else {
        const res = await register({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          ...(invite ? { inviteCode: invite } : {}),
          ...(form.referralSource ? { referralSource: form.referralSource } : {}),
          ...(form.referralSource === 'other' && form.referralSourceDetail
            ? { referralSourceDetail: form.referralSourceDetail }
            : {}),
        });
        if (res?.verificationRequired) {
          setVerify({ email: res.email, devCode: res.devCode });
          setCode('');
          setSubmitting(false);
          return; // confirm the emailed code before the account is active
        }
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Authentication failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitVerify = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await verifyEmail(verify.email, code.trim());
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Verification failed'));
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setError('');
    setResent('');
    try {
      const res = await resendVerification(verify.email);
      setVerify((v) => ({ ...v, devCode: res?.devCode ?? v.devCode }));
      setResent('A new code is on its way.');
    } catch (err) {
      setError(errorMessage(err, 'Could not resend the code'));
    }
  };

  const verifyTwoFactor = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await completeTwoFactor(twoFactor.challengeToken, code.trim(), trustDevice);
      if (res?.pendingDeletion) {
        setTwoFactor(null);
        setCode('');
        setRestoring(res);
        setSubmitting(false);
        return; // scheduled for deletion — offer to restore
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Verification failed'));
      setSubmitting(false);
    }
  };

  const submitRestore = async () => {
    setError('');
    setSubmitting(true);
    try {
      await restore(restoring.restoreToken);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not restore your account. Please sign in again.'));
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
            {mode === 'login'
              ? 'Welcome back — sign in to keep climbing'
              : showWaitlist
                ? 'We open to everyone soon — grab your spot'
                : 'Create your account and start the climb'}
          </p>
        </div>

        {restoring ? (
          <div className="glass-panel space-y-4 p-6">
            <div>
              <h2 className="text-lg font-bold text-ink">Restore your account?</h2>
              <p className="mt-0.5 text-sm text-muted">
                {restoring.email ? <>The account for <span className="font-semibold text-ink">{restoring.email}</span> is </> : 'This account is '}
                scheduled for deletion
                {restoring.deletionScheduledFor && (
                  <> on <span className="font-semibold text-ink">
                    {new Date(restoring.deletionScheduledFor).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span></>
                )}
                . Restore it now to pick up right where you left off.
              </p>
            </div>
            <ErrorBanner message={error} />
            <button type="button" onClick={submitRestore} disabled={submitting} className="btn btn-primary w-full">
              {submitting ? 'Restoring…' : 'Restore my account'}
            </button>
            <button
              type="button"
              onClick={() => { setRestoring(null); setForm((f) => ({ ...f, password: '' })); setError(''); }}
              className="w-full text-center text-sm font-semibold text-muted hover:text-ink"
            >
              ← Back to sign in
            </button>
          </div>
        ) : forgot ? (
          <ForgotPasswordPanel
            initialEmail={form.email}
            onBack={() => setForgot(false)}
            onDone={(email) => { setForgot(false); setMode('login'); setForm((f) => ({ ...f, email, password: '' })); setError(''); }}
          />
        ) : verify ? (
          <form onSubmit={submitVerify} className="glass-panel space-y-4 p-6">
            <div>
              <h2 className="text-lg font-bold text-ink">Confirm your email</h2>
              <p className="mt-0.5 text-sm text-muted">
                We sent a 6-digit code to <span className="font-semibold text-ink">{verify.email}</span>. Enter it below to activate your account.
              </p>
            </div>
            <ErrorBanner message={error} />
            {verify.devCode && (
              <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-amber-900">
                Dev mode — your code is <span className="font-mono font-bold">{verify.devCode}</span>
              </p>
            )}
            {resent && <p className="text-sm font-medium text-brand-600">{resent}</p>}
            <Field
              label="Confirmation code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              required
            />
            <button type="submit" disabled={submitting || !code.trim()} className="btn btn-primary w-full">
              {submitting ? 'Confirming…' : 'Confirm & continue'}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => { setVerify(null); setCode(''); setError(''); setResent(''); }}
                className="font-semibold text-muted hover:text-ink"
              >
                ← Back
              </button>
              <button type="button" onClick={resend} className="font-semibold text-brand-600 hover:underline">
                Resend code
              </button>
            </div>
          </form>
        ) : twoFactor ? (
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
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="h-4 w-4 rounded border-white/60 accent-brand-600"
              />
              Trust this device for 30 days
            </label>
            <button type="submit" disabled={submitting || !code.trim()} className="btn btn-primary w-full">
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setTwoFactor(null); setCode(''); setError(''); setTrustDevice(false); }}
              className="w-full text-center text-sm font-semibold text-muted hover:text-ink"
            >
              ← Back to sign in
            </button>
          </form>
        ) : showWaitlist ? (
          <>
            <WaitlistPanel />
            <p className="mt-4 text-center text-sm text-muted">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); }}
                className="font-semibold text-brand-600 hover:underline"
              >
                Sign in
              </button>
            </p>
          </>
        ) : (
        <form onSubmit={handleSubmit} className="glass-panel space-y-4 p-6">
          <ErrorBanner message={error} />

          <SocialAuthButtons />

          {mode === 'register' && invite && (
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundImage: 'var(--grad-teal-purple)' }} />
                Invited — code applied
              </span>
            </div>
          )}

          {mode === 'register' && (
            <Field label="Full name" value={form.fullName} onChange={update('fullName')} required />
          )}
          <Field label="Email" type="email" value={form.email} onChange={update('email')} required />
          <Field label="Password" type="password" value={form.password} onChange={update('password')} required />

          {mode === 'login' && (
            <div className="-mt-1 text-right">
              <button
                type="button"
                onClick={() => { setForgot(true); setError(''); }}
                className="text-sm font-semibold text-brand-600 hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}

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
        )}
      </div>
    </div>
  );
}

/**
 * Forgot-password flow: pick where to send a reset code (primary email, backup
 * email, or SMS), enter the code + a new password, done. The server answers
 * generically so no step reveals whether an account or channel exists.
 */
function ForgotPasswordPanel({ initialEmail, onBack, onDone }) {
  const [stage, setStage] = useState('request'); // request | reset
  const [email, setEmail] = useState(initialEmail || '');
  const [method, setMethod] = useState('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const METHODS = [
    { value: 'email', label: 'Primary email' },
    { value: 'recovery_email', label: 'Recovery email' },
    { value: 'sms', label: 'Text (SMS)' },
  ];

  const sendCode = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/api/auth/forgot-password', { email: email.trim().toLowerCase(), method });
      setDevCode(data.devCode || '');
      setStage('reset');
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong. Please try again.'));
    } finally { setBusy(false); }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/api/auth/reset-password', { email: email.trim().toLowerCase(), code: code.trim(), newPassword: password });
      onDone(email.trim().toLowerCase());
    } catch (err) {
      setError(errorMessage(err, 'That code is not valid.'));
      setBusy(false);
    }
  };

  const chosen = METHODS.find((m) => m.value === method)?.label.toLowerCase();

  return stage === 'request' ? (
    <form onSubmit={sendCode} className="glass-panel space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold text-ink">Reset your password</h2>
        <p className="mt-0.5 text-sm text-muted">Enter your account email and where to send a reset code.</p>
      </div>
      <ErrorBanner message={error} />
      <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" autoComplete="email" autoFocus required />
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink">Send the code to</span>
        <div className="grid grid-cols-3 gap-1.5">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMethod(m.value)}
              className={`rounded-xl px-2 py-2 text-xs font-semibold transition ${
                method === m.value ? 'bg-brand-600 text-white shadow-sm' : 'bg-white/60 text-muted hover:bg-white/80'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <button type="submit" disabled={busy || !email.trim()} className="btn btn-primary w-full">
        {busy ? 'Sending…' : 'Send reset code'}
      </button>
      <button type="button" onClick={onBack} className="w-full text-center text-sm font-semibold text-muted hover:text-ink">
        ← Back to sign in
      </button>
    </form>
  ) : (
    <form onSubmit={submitReset} className="glass-panel space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold text-ink">Enter your code</h2>
        <p className="mt-0.5 text-sm text-muted">
          If an account exists with a verified {chosen}, we've sent a 6-digit code. Enter it and choose a new password.
        </p>
      </div>
      {devCode && (
        <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-amber-900">
          Dev mode — your code is <span className="font-mono font-bold">{devCode}</span>
        </p>
      )}
      <ErrorBanner message={error} />
      <Field label="Reset code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" inputMode="numeric" autoFocus required />
      <Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required />
      <button type="submit" disabled={busy || !code.trim() || password.length < 8} className="btn btn-primary w-full">
        {busy ? 'Resetting…' : 'Reset password'}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={() => { setStage('request'); setError(''); }} className="font-semibold text-muted hover:text-ink">← Back</button>
        <button type="button" onClick={sendCode} className="font-semibold text-brand-600 hover:underline">Resend code</button>
      </div>
    </form>
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
