import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner } from '../components/ui';

/**
 * Public set-password page for institution-admin invite links
 * (/set-password?token=…). Validates the one-time token, then lets the invitee
 * set a password to activate their account.
 */
export default function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [state, setState] = useState('loading'); // loading | ready | invalid
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) { setState('invalid'); return; }
    api.get(`/api/auth/invite/${token}`)
      .then((r) => { setEmail(r.data.email); setState('ready'); })
      .catch(() => setState('invalid'));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.length < 8) return setError('Password must be at least 8 characters.');
    if (pw !== confirm) return setError('Passwords do not match.');
    setSaving(true);
    try {
      await api.post(`/api/auth/invite/${token}/accept`, { password: pw });
      navigate('/login?activated=1');
    } catch (err) {
      setError(errorMessage(err, 'Could not set your password.'));
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-7">
        <h1 className="font-display text-2xl font-bold text-ink">Set your password</h1>

        {state === 'loading' && <div className="mt-6"><Spinner label="Checking your invite…" /></div>}

        {state === 'invalid' && (
          <div className="mt-4">
            <p className="text-sm text-muted">This invite link is invalid or has expired. Ask your Summit contact to send a new one.</p>
            <Link to="/login" className="btn btn-soft mt-4 inline-block">Back to sign in</Link>
          </div>
        )}

        {state === 'ready' && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <p className="text-sm text-muted">Activating <span className="font-semibold text-ink">{email}</span></p>
            {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink">New password</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="field" autoComplete="new-password" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink">Confirm password</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field" autoComplete="new-password" />
            </label>
            <button type="submit" disabled={saving} className="btn btn-primary w-full">
              {saving ? 'Setting password…' : 'Set password & continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
