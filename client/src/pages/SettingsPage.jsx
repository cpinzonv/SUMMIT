import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../api/client';
import { ErrorBanner, Toast, Toggle, Modal, Spinner, classGradient, gradeColor } from '../components/ui';
import { lmsApi, lmsStatusAll, beginConnect, summarizeSync, LMS_META } from '../lib/lms';
import { gcalApi, summarizeGcalSync } from '../lib/gcal';
import SettingsGraduationSection from '../components/SettingsGraduationSection';

const TABS = [
  { key: 'account', label: 'Account' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'display', label: 'Display' },
];

export default function SettingsPage() {
  const { user, preferences, savePreferences } = useAuth();
  // Land on Preferences (where the LMS connections live) when returning from the
  // OAuth redirect (?lms=... ; ?canvas=... kept for backward-compatible links).
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.has('lms') || q.has('canvas') || q.has('gcal') ? 'preferences' : 'account';
  });
  const set = (key) => (value) => savePreferences({ [key]: value });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">Manage your account and how Summit looks.</p>

      <div className="mb-6 mt-5 flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? 'bg-white/75 text-brand-700 shadow-sm' : 'text-muted hover:bg-white/50 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountTab user={user} />}
      {tab === 'preferences' && <PreferencesTab prefs={preferences} set={set} />}
      {tab === 'display' && <DisplayTab prefs={preferences} set={set} />}
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="glass-card mb-5 p-6">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mb-4 mt-0.5 text-sm text-muted">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/40 py-3 last:border-0">
      <div>
        <div className="text-sm font-semibold text-ink">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ---- Account ----------------------------------------------------------- */
function AccountTab({ user }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const created = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <>
      <Section title="Account">
        <Row label="Email">{<span className="text-sm text-muted">{user?.email}</span>}</Row>
        <Row label="Member since">{<span className="text-sm text-muted">{created}</span>}</Row>
      </Section>

      <ChangeEmailSection user={user} />

      <ChangePassword />

      <RecoverySection user={user} />

      <TwoFactorSection user={user} />

      <Section title="Session" description="Sign out of Summit on this device.">
        <button onClick={handleLogout} className="btn btn-soft">
          Log out
        </button>
      </Section>
    </>
  );
}

/* ---- Account security & recovery --------------------------------------- */

/**
 * A contact (phone or backup email) you add, then confirm with a one-time code.
 * Handles all three states: none yet (add form), pending confirmation (enter the
 * code), and verified (badge + remove). `devCode` is surfaced in dev when no
 * provider is configured so the flow is testable without real delivery.
 */
function VerifiableContact({
  title, description, inputLabel, inputType, placeholder, autoComplete,
  value, verified, addUrl, verifyUrl, removeUrl, buildBody, sentHint,
}) {
  const { refreshUser } = useAuth();
  const [stage, setStage] = useState(value && !verified ? 'code' : 'idle');
  const [input, setInput] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const startAdd = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await api.post(addUrl, buildBody(input.trim()));
      setDevCode(data.devCode || '');
      setStage('code');
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong. Please try again.'));
    } finally { setBusy(false); }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post(verifyUrl, { code: code.trim() });
      await refreshUser();
      setStage('idle'); setInput(''); setCode(''); setDevCode('');
    } catch (err) {
      setError(errorMessage(err, 'That code is not valid.'));
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setError('');
    try {
      const { data } = await api.post(addUrl, buildBody(value));
      setDevCode(data.devCode || '');
      setToast({ type: 'success', msg: 'A new code is on its way.' });
    } catch (err) { setError(errorMessage(err, 'Could not resend the code.')); }
  };

  const remove = async () => {
    setBusy(true); setError('');
    try { await api.delete(removeUrl); await refreshUser(); setStage('idle'); setDevCode(''); }
    catch (err) { setError(errorMessage(err, 'Could not remove it.')); }
    finally { setBusy(false); }
  };

  return (
    <Section title={title} description={description}>
      <Toast toast={toast} />

      {verified ? (
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="font-semibold text-ink">{value}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-600">✓ Verified</span>
          </span>
          <button onClick={remove} disabled={busy} className="btn btn-soft">Remove</button>
        </div>
      ) : stage === 'code' ? (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-muted">{sentHint(value || input)}</p>
          {devCode && (
            <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-amber-900">
              Dev mode — your code is <span className="font-mono font-bold">{devCode}</span>
            </p>
          )}
          <ErrorBanner message={error} />
          <Field label="Confirmation code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" inputMode="numeric" required />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !code.trim()} className="btn btn-primary">{busy ? 'Confirming…' : 'Confirm'}</button>
            <button type="button" onClick={resend} className="btn btn-soft">Resend code</button>
            <button type="button" onClick={remove} disabled={busy} className="text-sm font-semibold text-muted hover:text-ink">Cancel</button>
          </div>
        </form>
      ) : (
        <form onSubmit={startAdd} className="space-y-3">
          <ErrorBanner message={error} />
          <Field label={inputLabel} type={inputType} value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} required />
          <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary">{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      )}
    </Section>
  );
}

/** Phone (SMS) + backup recovery email — both used to recover a locked-out account. */
function RecoverySection({ user }) {
  return (
    <>
      <VerifiableContact
        title="Recovery phone"
        description="Add a mobile number so you can reset your password by text. Optional, but recommended."
        inputLabel="Phone number"
        inputType="tel"
        placeholder="+1 555 123 4567"
        autoComplete="tel"
        value={user?.phone}
        verified={user?.phoneVerified}
        addUrl="/api/user/phone"
        verifyUrl="/api/user/phone/verify"
        removeUrl="/api/user/phone"
        buildBody={(phone) => ({ phone })}
        sentHint={(to) => `We texted a 6-digit code to ${to}. Enter it below to confirm your number.`}
      />
      <VerifiableContact
        title="Recovery email"
        description="A backup email we can use if you ever lose access to your primary address."
        inputLabel="Backup email"
        inputType="email"
        placeholder="you@backup.com"
        autoComplete="email"
        value={user?.recoveryEmail}
        verified={user?.recoveryEmailVerified}
        addUrl="/api/user/recovery-email"
        verifyUrl="/api/user/recovery-email/verify"
        removeUrl="/api/user/recovery-email"
        buildBody={(email) => ({ email })}
        sentHint={(to) => `We emailed a 6-digit code to ${to}. Enter it below to confirm.`}
      />
    </>
  );
}

/** Change the primary email: confirm a code sent to the NEW address; the old one gets a heads-up. */
function ChangeEmailSection({ user }) {
  const { refreshUser } = useAuth();
  const [stage, setStage] = useState('idle'); // idle | code
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const request = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/api/user/email/change', { email: newEmail.trim() });
      setDevCode(data.devCode || '');
      setStage('code');
    } catch (err) { setError(errorMessage(err, 'Could not start the change.')); }
    finally { setBusy(false); }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/api/user/email/change/verify', { code: code.trim() });
      await refreshUser();
      setStage('idle'); setNewEmail(''); setCode(''); setDevCode('');
      setToast({ type: 'success', msg: 'Your email address was updated.' });
    } catch (err) { setError(errorMessage(err, 'That code is not valid.')); }
    finally { setBusy(false); }
  };

  return (
    <Section
      title="Change email"
      description="Move your account to a new email. We'll send a code to the new address to confirm it, and notify your current one."
    >
      <Toast toast={toast} />
      <Row label="Current email"><span className="text-sm text-muted">{user?.email}</span></Row>

      {stage === 'code' ? (
        <form onSubmit={confirm} className="mt-4 space-y-3">
          <p className="text-sm text-muted">We emailed a 6-digit code to <span className="font-semibold text-ink">{newEmail}</span>. Enter it to finish the switch.</p>
          {devCode && (
            <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-amber-900">
              Dev mode — your code is <span className="font-mono font-bold">{devCode}</span>
            </p>
          )}
          <ErrorBanner message={error} />
          <Field label="Confirmation code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" inputMode="numeric" required />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy || !code.trim()} className="btn btn-primary">{busy ? 'Confirming…' : 'Confirm & switch'}</button>
            <button type="button" onClick={() => { setStage('idle'); setCode(''); setError(''); }} className="text-sm font-semibold text-muted hover:text-ink">Cancel</button>
          </div>
        </form>
      ) : (
        <form onSubmit={request} className="mt-4 space-y-3">
          <ErrorBanner message={error} />
          <Field label="New email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@newschool.edu" autoComplete="email" required />
          <button type="submit" disabled={busy || !newEmail.trim()} className="btn btn-primary">{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      )}
    </Section>
  );
}

/* ---- Two-factor authentication ----------------------------------------- */
function TwoFactorSection({ user }) {
  const { refreshUser } = useAuth();
  const [flow, setFlow] = useState(null); // 'enable' | 'disable'
  const enabled = Boolean(user?.twoFactorEnabled);
  const done = async () => { setFlow(null); await refreshUser(); };

  return (
    <Section
      title="Two-factor authentication"
      description="Add a second step at login with an authenticator app (TOTP), like GitHub or Google."
    >
      {enabled ? (
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-600">
            ✓ Enabled
          </span>
          <button onClick={() => setFlow('disable')} className="btn btn-soft">Disable</button>
        </div>
      ) : (
        <button onClick={() => setFlow('enable')} className="btn btn-primary">Enable 2FA</button>
      )}
      {flow === 'enable' && <Enable2FAModal onClose={() => setFlow(null)} onDone={done} />}
      {flow === 'disable' && <Disable2FAModal onClose={() => setFlow(null)} onDone={done} />}
    </Section>
  );
}

function Enable2FAModal({ onClose, onDone }) {
  const [step, setStep] = useState('loading'); // loading | scan | backup | error
  const [data, setData] = useState(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Load a pending secret + QR. On failure — including a hung/slow request (15s
  // timeout) — surface the error and stop spinning instead of "Preparing…" forever.
  const load = useCallback(() => {
    setStep('loading');
    setError('');
    api
      .post('/api/user/2fa/setup', null, { timeout: 15000 })
      .then((r) => { setData(r.data); setStep('scan'); })
      .catch((err) => {
        setError(errorMessage(err, 'Could not start 2FA setup. Please try again.'));
        setStep('error');
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/api/user/2fa/confirm', { code: code.trim() });
      setBackupCodes(r.data.backupCodes);
      setStep('backup');
    } catch (err) {
      setError(errorMessage(err, 'Invalid code.'));
      setBusy(false);
    }
  };

  return (
    <Modal title="Enable two-factor authentication" onClose={onClose}>
      {step === 'loading' && <Spinner label="Preparing…" />}
      {step === 'error' && (
        <div className="space-y-4">
          <ErrorBanner message={error || 'Could not start 2FA setup.'} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-soft">Close</button>
            <button type="button" onClick={load} className="btn btn-primary">Try again</button>
          </div>
        </div>
      )}
      {step === 'scan' && data && (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-muted">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password…),
            then enter the 6-digit code it shows.
          </p>
          <img src={data.qrCode} alt="2FA QR code" className="mx-auto h-44 w-44 rounded-xl border border-white/60 bg-white p-2" />
          <p className="break-all text-center text-xs text-muted">
            Can’t scan? Enter this key: <code className="font-mono text-ink">{data.secret}</code>
          </p>
          <ErrorBanner message={error} />
          <Field label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" required />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
            <button type="submit" disabled={busy || !code.trim()} className="btn btn-primary">{busy ? 'Verifying…' : 'Verify & enable'}</button>
          </div>
        </form>
      )}
      {step === 'backup' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink">Save your backup codes</p>
          <p className="text-sm text-muted">
            Store these somewhere safe. Each works once if you lose access to your authenticator —
            they won’t be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/60 bg-white/55 p-4 text-center font-mono text-sm text-ink">
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n'))}
            className="text-xs font-semibold text-brand-600 hover:underline"
          >
            Copy all codes
          </button>
          <div className="flex justify-end">
            <button onClick={onDone} className="btn btn-primary">I’ve saved them — done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Disable2FAModal({ onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/user/2fa/disable', { password });
      await onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not disable 2FA.'));
      setBusy(false);
    }
  };
  return (
    <Modal title="Disable two-factor authentication" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">Enter your password to turn off 2FA.</p>
        <ErrorBanner message={error} />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={busy || !password} className="btn btn-danger">{busy ? 'Disabling…' : 'Disable 2FA'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (form.next.length < 8) return setError('New password must be at least 8 characters.');
    if (form.next !== form.confirm) return setError('New passwords do not match.');
    setSaving(true);
    try {
      await api.patch('/api/auth/password', {
        currentPassword: form.current,
        newPassword: form.next,
      });
      setSuccess('Password updated.');
      setForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      setError(errorMessage(err, 'Could not update password.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Change password">
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorBanner message={error} />}
        {success && (
          <div className="rounded-2xl border border-emerald-300/50 bg-emerald-50/70 px-4 py-3 text-sm font-medium text-emerald-700">
            {success}
          </div>
        )}
        <Field label="Current password" type="password" value={form.current} onChange={update('current')} required />
        <Field label="New password" type="password" value={form.next} onChange={update('next')} required />
        <Field label="Confirm new password" type="password" value={form.confirm} onChange={update('confirm')} required />
        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </Section>
  );
}

/* ---- Podcast host voices ----------------------------------------------- */
const prettyLabel = (s) => (s || '').replace(/_/g, ' ');
const voiceShortName = (v) => (v?.name || '').split(/\s*[-—]\s*/)[0].trim() || v?.name || '';
const voiceMeta = (v) => {
  const [gender = '', accent = '', style = ''] = (v?.description || '').split(' · ');
  return { gender, accent, style };
};
const GENDER_GRAD = {
  female: 'linear-gradient(135deg, #FF8A5B, #FF5E7E)',
  male: 'linear-gradient(135deg, #4FC3DC, #5B8DEF)',
  neutral: 'linear-gradient(135deg, #B084F5, #7E7BF5)',
};
const voiceGrad = (v) => GENDER_GRAD[voiceMeta(v).gender] || 'linear-gradient(135deg, #FF8A5B, #4FC3DC)';

/** Map a voice's vibe to a face "personality" that drives its expression. */
function faceArchetype(voice) {
  const s = (voiceMeta(voice).style || '').toLowerCase();
  const n = (voice?.name || '').toLowerCase();
  if (s.includes('educational') || /educator|professor|teacher|knowledg/.test(n)) return 'smart';
  if (s.includes('social')) return 'energetic';
  if (s.includes('character') || s.includes('animation') || /trickster|warrior|quirky/.test(n)) return 'playful';
  if (s.includes('narrative') || s.includes('story') || s.includes('meditation') || /calm|relaxed|velvety/.test(n)) return 'calm';
  if (s.includes('advertisement') || s.includes('entertainment') || /confident|dominant|firm/.test(n)) return 'confident';
  return 'friendly';
}

/* Cartoon-avatar palettes + a stable hash so each voice keeps the same look. */
const SKINS = ['#F7D7B5', '#F0C49A', '#E0A878', '#C68A5E', '#A56A44', '#8A5636'];
const HAIRS = ['#2C221B', '#4A3225', '#6B4A2E', '#9A6A3A', '#C99A5B', '#1F1F1F', '#7A4B3A', '#B5561E'];
// Big anime/MLP-style irises: a darker base + a lighter lower tone for the "glow".
const EYE_PAIRS = [
  { base: '#6B4A2B', light: '#B07A45' }, // warm brown
  { base: '#2E6FB0', light: '#7EC0E8' }, // bright blue
  { base: '#3E8E5A', light: '#8AD79A' }, // green
  { base: '#7E5AA8', light: '#C29BE0' }, // violet
  { base: '#2E9AA0', light: '#7FD9D2' }, // teal
  { base: '#B5762A', light: '#E6BE64' }, // amber
];
const SHIRTS = ['#5B8DEF', '#FF8A5B', '#4FC3DC', '#B084F5', '#57B894', '#F2777A'];
const OUTFITS = ['crew', 'collar', 'stripe', 'hoodie', 'vneck', 'crew'];
const ACC_COLORS = ['#FF6B9D', '#FF5E7E', '#7E5AA8', '#FF8A5B', '#4FC3DC', '#F2C94C'];
const hashInt = (s) => { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/** Pick a cute, gender-appropriate accessory (or none) from the hash. */
function pickAccessory(gender, h) {
  const list = gender === 'female' ? ['earrings', 'bow', 'headband']
    : gender === 'male' ? ['cap', 'beanie', 'headphones', 'none']
    : ['headphones', 'beanie', 'headband', 'none'];
  return list[(h >> 9) % list.length];
}

function avatarParams(voice) {
  if (!voice) {
    return { skin: '#EAD7C2', hair: '#9AA3AF', eye: { base: '#6B7280', light: '#AAB2BD' }, shirt: '#B8C0CC', hairStyle: 'short', arch: 'friendly', lashes: false };
  }
  const h = hashInt(voice.id);
  const { gender } = voiceMeta(voice);
  const styles = gender === 'female' ? ['bob', 'long', 'bun', 'curly']
    : gender === 'male' ? ['short', 'buzz', 'curly', 'short']
    : ['short', 'bob', 'curly', 'bun'];
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >> 3) % HAIRS.length],
    eye: EYE_PAIRS[(h >> 6) % EYE_PAIRS.length],
    shirt: SHIRTS[(h >> 8) % SHIRTS.length],
    hairStyle: styles[(h >> 10) % styles.length],
    arch: faceArchetype(voice),
    lashes: gender === 'female',
    outfit: OUTFITS[(h >> 16) % OUTFITS.length],
    accent: SHIRTS[(h >> 18) % SHIRTS.length],
    accessory: pickAccessory(gender, h),
    accColor: ACC_COLORS[(h >> 20) % ACC_COLORS.length],
  };
}

/**
 * SVG hair over the head (head ~cx50 cy53 rx26 ry29). Drawn on top of the face
 * with a low hairline so the forehead is covered (no "egg" look). A soft
 * highlight adds a bit of shine.
 */
function Hair({ style, color }) {
  const shine = 'rgba(255,255,255,0.18)';
  switch (style) {
    case 'buzz': // short crop, low fringe
      return (
        <g fill={color}>
          <path d="M23 45 C21 25 35 16 50 16 C65 16 79 25 77 45 C74 40 70 37 63 37 Q56 33 50 34 Q44 33 37 37 C30 37 26 40 23 45 Z" />
          <path d="M50 16 C63 16 76 24 76 42 C72 34 64 30 50 30 Z" fill={shine} />
        </g>
      );
    case 'curly': // full rounded curls framing the face
      return (
        <g fill={color}>
          <circle cx="31" cy="30" r="11" /><circle cx="44" cy="23" r="11" /><circle cx="57" cy="23" r="11" />
          <circle cx="69" cy="30" r="11" /><circle cx="24" cy="42" r="9" /><circle cx="76" cy="42" r="9" />
          <path d="M28 40 Q50 26 72 40 Q50 34 28 40 Z" fill={shine} />
        </g>
      );
    case 'bun': // sleek cap + top bun
      return (
        <g fill={color}>
          <circle cx="50" cy="13" r="8" />
          <path d="M23 46 C22 25 36 17 50 17 C64 17 78 25 77 46 C74 38 69 34 61 34 Q50 31 39 34 C31 34 26 38 23 46 Z" />
          <path d="M50 17 C64 17 76 25 76 42 C72 33 64 30 50 30 Z" fill={shine} />
        </g>
      );
    case 'bob': // chin-length, frames the face
      return (
        <g fill={color}>
          <path d="M20 64 C18 27 34 16 50 16 C66 16 82 27 80 64 L80 48 C78 39 71 35 63 34 Q50 31 37 34 C29 35 22 39 20 48 Z" />
          <path d="M50 16 C64 16 78 26 79 46 C74 37 66 33 50 32 Z" fill={shine} />
        </g>
      );
    case 'long': // flowing past the shoulders
      return (
        <g fill={color}>
          <path d="M18 86 C16 27 34 14 50 14 C66 14 84 27 82 86 L82 44 C79 37 71 34 63 33 Q50 30 37 33 C29 34 21 37 18 44 Z" />
          <path d="M50 14 C65 14 81 26 82 44 C76 35 66 31 50 30 Z" fill={shine} />
        </g>
      );
    default: // short, textured with a soft side sweep
      return (
        <g fill={color}>
          <path d="M22 46 C20 24 35 15 50 15 C65 15 80 24 78 46 C75 39 71 35 63 35 Q56 30 48 32 Q41 30 34 35 C28 36 25 40 22 46 Z" />
          <path d="M50 15 C64 15 77 24 77 43 C72 34 63 31 49 32 Z" fill={shine} />
        </g>
      );
  }
}

/** A cute cartoon-avatar face (bitmoji-style): skin, hair, colored eyes, blush, smile. */
function VoiceFace({ voice, playing, index = 0 }) {
  // The "default" option isn't a person — show a neutral microphone glyph so it
  // reads as "app default voice", not a face/skin tone.
  if (!voice) {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        <g className="vf-face">
          <rect x="41" y="27" width="18" height="34" rx="9" fill="#fff" />
          <g fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M33 50 a17 17 0 0 0 34 0" />
            <line x1="50" y1="67" x2="50" y2="77" />
            <line x1="40" y1="78" x2="60" y2="78" />
          </g>
        </g>
      </svg>
    );
  }
  const p = avatarParams(voice) || {};
  const { skin, hair, shirt, hairStyle, arch, lashes, outfit, accent, accessory, accColor } = p;
  const eye = p.eye || { base: '#6B7280', light: '#AAB2BD' };
  const eyeDelay = `${(index % 6) * 0.65}s`;
  // Big, glossy anime/MLP-style eye: sclera → two-tone iris → pupil → 2 highlights.
  const Eye = (cx, out) => (
    <g>
      {lashes && (
        <g stroke="#2b2320" strokeWidth="1.4" strokeLinecap="round">
          <path d={`M${cx + out * 6.4} 42.6 q${out * 2} -1.4 ${out * 3.4} -2.6`} />
          <path d={`M${cx + out * 5} 41.6 q${out * 1} -1.6 ${out * 1.8} -3`} />
        </g>
      )}
      <ellipse cx={cx} cy="49" rx="6.6" ry="8.2" fill="#fff" />
      <circle cx={cx} cy="50" r="5.7" fill={eye.base} />
      <circle cx={cx} cy="52.4" r="4.4" fill={eye.light} />
      <circle cx={cx} cy="50.4" r="2.9" fill="#231712" />
      <ellipse cx={cx - 1.9} cy="47.2" rx="2.1" ry="2.7" fill="#fff" />
      <circle cx={cx + 1.9} cy="52" r="1.15" fill="#fff" opacity="0.9" />
    </g>
  );
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      <g className={`vf-face ${arch}`} style={{ animationDelay: `${(index % 5) * 0.4}s` }}>
        {/* shoulders / shirt + outfit details */}
        <path d="M26 98 Q28 82 42 79 Q50 85 58 79 Q72 82 74 98 Z" fill={shirt} />
        {outfit === 'stripe' && <path d="M27 89 Q50 95 73 89 L73 94 Q50 100 27 94 Z" fill={accent} />}
        {outfit === 'hoodie' && (
          <g>
            <path d="M29 83 Q50 92 71 83 Q68 98 50 98 Q32 98 29 83 Z" fill={accent} />
            <line x1="47" y1="86" x2="47" y2="95" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="53" y1="86" x2="53" y2="95" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        )}
        <path d="M43 76 Q50 82 57 76 L57 70 Q50 73 43 70 Z" fill={skin} />
        {outfit === 'collar' && <g fill={accent}><path d="M44 79 L37 87 L46 84 Z" /><path d="M56 79 L63 87 L54 84 Z" /></g>}
        {outfit === 'vneck' && <path d="M44 79 L50 89 L56 79 Z" fill={skin} />}
        {/* head + ears */}
        <circle cx="24" cy="55" r="4.5" fill={skin} />
        <circle cx="76" cy="55" r="4.5" fill={skin} />
        <ellipse cx="50" cy="53" rx="26" ry="29" fill={skin} />
        {/* hair drawn in front so the forehead is always covered */}
        <Hair style={hairStyle} color={hair} />
        {/* eyebrows */}
        <g stroke={hair} strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M31 38 Q38 34.5 45 37.5" /><path d="M55 37.5 Q62 34.5 69 38" />
        </g>
        {/* eyes (blink) */}
        <g className="vf-eyes" style={{ animationDelay: eyeDelay }}>{Eye(38, -1)}{Eye(62, 1)}</g>
        {/* glasses for the studious ones */}
        {arch === 'smart' && (
          <g fill="none" stroke="#3b3b3b" strokeWidth="2.2" opacity="0.9">
            <rect x="29.5" y="41.5" width="17" height="16" rx="6" />
            <rect x="53.5" y="41.5" width="17" height="16" rx="6" />
            <path d="M46.5 49 h7" strokeLinecap="round" />
          </g>
        )}
        {/* nose + cheeks */}
        <path d="M50 55 L48.4 59 Q50 60.2 51.6 59" fill="none" stroke="rgba(120,72,40,0.3)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx="30" cy="62" rx="4.6" ry="2.9" fill="#FF8A7A" opacity="0.5" />
        <ellipse cx="70" cy="62" rx="4.6" ry="2.9" fill="#FF8A7A" opacity="0.5" />
        {/* mouth */}
        <g className={`vf-mouth ${playing ? 'vf-talking' : ''}`}>
          {playing ? (
            <ellipse cx="50" cy="66" rx="3.4" ry="3.8" fill="#B5503F" />
          ) : arch === 'playful' ? (
            <g>
              <path d="M44 64 Q50 71 56 64 Q50 67.5 44 64 Z" fill="#B5503F" />
              <path d="M46 64.6 Q50 66 54 64.6 Q50 65.4 46 64.6 Z" fill="#fff" />
            </g>
          ) : arch === 'energetic' ? (
            <path d="M45 64 Q50 70 55 64 Q50 67 45 64 Z" fill="#B5503F" />
          ) : arch === 'confident' ? (
            <path d="M45 66 Q51 69.5 57 64" fill="none" stroke="#B5503F" strokeWidth="2.4" strokeLinecap="round" />
          ) : arch === 'calm' ? (
            <path d="M46 65 Q50 68 54 65" fill="none" stroke="#B5503F" strokeWidth="2.4" strokeLinecap="round" />
          ) : (
            <path d="M45 64.5 Q50 68.5 55 64.5" fill="none" stroke="#B5503F" strokeWidth="2.4" strokeLinecap="round" />
          )}
        </g>
        {/* accessories (drawn last so hats sit over the hair) */}
        {accessory === 'earrings' && (
          <g fill="#F3C969" stroke="#D9A93C" strokeWidth="0.5">
            <circle cx="24" cy="61.5" r="2.1" /><circle cx="76" cy="61.5" r="2.1" />
          </g>
        )}
        {accessory === 'bow' && (
          <g fill={accColor}>
            <path d="M30 25 L38 21 L38 30 Z" /><path d="M46 25 L38 21 L38 30 Z" />
            <circle cx="38" cy="25.5" r="2.4" />
          </g>
        )}
        {accessory === 'headband' && <path d="M24 35 Q50 25 76 35 L76 40 Q50 30 24 40 Z" fill={accColor} />}
        {accessory === 'cap' && (
          <g>
            <path d="M20 39 Q50 11 80 39 Q50 31 20 39 Z" fill={accColor} />
            <circle cx="50" cy="17" r="2" fill="#fff" opacity="0.85" />
          </g>
        )}
        {accessory === 'beanie' && (
          <g fill={accColor}>
            <path d="M20 39 Q50 12 80 39 Q50 31 20 39 Z" />
            <path d="M21 37 Q50 40 79 37 L79 39 Q50 42 21 39 Z" fill="rgba(0,0,0,0.14)" />
            <circle cx="50" cy="14" r="4" />
          </g>
        )}
        {accessory === 'headphones' && (
          <g>
            <path d="M21 45 Q50 15 79 45" fill="none" stroke="#3a3a3a" strokeWidth="4.5" strokeLinecap="round" />
            <rect x="15.5" y="46" width="10" height="16" rx="4.5" fill="#3a3a3a" />
            <rect x="74.5" y="46" width="10" height="16" rx="4.5" fill="#3a3a3a" />
          </g>
        )}
      </g>
    </svg>
  );
}

/** A single profile bubble — animated face, name, vibe; ring when picked, talks while previewing. */
function VoiceBubble({ voice, selected, playing, index, onClick }) {
  const name = voice ? voiceShortName(voice) : 'Default';
  const vibe = voice ? prettyLabel(voiceMeta(voice).style || voiceMeta(voice).accent || voiceMeta(voice).gender) : 'app default';
  return (
    <button
      type="button"
      onClick={onClick}
      title={voice ? `${voice.name} — ${voice.description}` : 'Use the app default voice'}
      className={`group flex w-[4.75rem] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl px-1 py-2 transition ${
        selected ? 'bg-white/70 ring-2 ring-brand-400' : 'hover:bg-white/45'
      }`}
    >
      <span
        className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-full shadow-md transition duration-200 group-hover:-translate-y-0.5 group-hover:scale-105"
        style={{ backgroundImage: voice ? voiceGrad(voice) : 'linear-gradient(135deg, #cbd5e1, #94a3b8)' }}
      >
        <VoiceFace voice={voice} playing={playing} index={index} />
        {selected && (
          <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[10px] font-bold text-white ring-2 ring-white">✓</span>
        )}
      </span>
      <span className="max-w-full truncate text-xs font-semibold text-ink">{name}</span>
      <span className="max-w-full truncate text-[10px] capitalize text-muted">{vibe}</span>
    </button>
  );
}

function PodcastVoicesSection({ prefs, set }) {
  const [voices, setVoices] = useState(null);
  const [err, setErr] = useState('');
  const [playingId, setPlayingId] = useState('');
  const audioRef = useRef(null);

  useEffect(() => {
    api
      .get('/api/learn/podcast-voices')
      .then((r) => setVoices(r.data.voices))
      .catch((e) => setErr(errorMessage(e)));
    return () => audioRef.current?.pause?.();
  }, []);

  const preview = (voiceId) => {
    audioRef.current?.pause?.();
    const v = voices?.find((x) => x.id === voiceId);
    if (!v?.previewUrl) { setPlayingId(''); return; }
    const a = new Audio(v.previewUrl);
    audioRef.current = a;
    setPlayingId(voiceId);
    a.onended = () => setPlayingId((p) => (p === voiceId ? '' : p));
    a.onerror = () => setPlayingId('');
    a.play().catch(() => setPlayingId(''));
  };

  // Click a bubble: select it (save pref) AND play its preview so you hear the pick.
  const choose = (prefKey) => (voiceId) => { set(prefKey)(voiceId); preview(voiceId); };

  const hosts = [
    { key: 'podcastVoiceA', name: 'Host A — Maya', hint: 'The curious co-host.' },
    { key: 'podcastVoiceB', name: 'Host B — Sam', hint: 'The expert who explains.' },
  ];

  return (
    <Section title="Podcast voices" description="Tap a bubble to pick each host's voice — you'll hear a quick preview. Maya asks the questions; Sam explains.">
      {err && <ErrorBanner message={err} />}
      {!voices ? (
        <p className="py-3 text-sm text-muted">Loading voices…</p>
      ) : (
        <div className="space-y-5">
          {hosts.map((h) => {
            const val = prefs[h.key] || '';
            const sel = voices.find((v) => v.id === val);
            return (
              <div key={h.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{h.name}</div>
                    <div className="text-xs text-muted">{h.hint}</div>
                  </div>
                  <div className="truncate text-xs text-muted">{sel ? prettyLabel(`${voiceShortName(sel)} · ${sel.description}`) : 'App default'}</div>
                </div>
                <div className="-mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1">
                  <VoiceBubble voice={null} selected={!val} playing={false} index={0} onClick={() => choose(h.key)('')} />
                  {voices.map((v, i) => (
                    <VoiceBubble key={v.id} voice={v} selected={val === v.id} playing={playingId === v.id} index={i + 1} onClick={() => choose(h.key)(v.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ---- Preferences ------------------------------------------------------- */
function PreferencesTab({ prefs, set }) {
  return (
    <>
      <Section title="Preferences" description="Defaults and notifications.">
        <Row label="Default dashboard view" hint="How classes appear on the dashboard.">
          <select value={prefs.defaultDashboardView} onChange={(e) => set('defaultDashboardView')(e.target.value)} className="field !w-auto">
            <option value="cards">Cards</option>
            <option value="list">List</option>
          </select>
        </Row>
        <Row label="Default calendar view">
          <RadioGroup
            name="calview"
            value={prefs.defaultCalendarView}
            onChange={set('defaultCalendarView')}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
              { value: 'day', label: 'Day' },
            ]}
          />
        </Row>
        <Row label="Email notifications" hint="Due-date reminders by email.">
          <Toggle on={!!prefs.notificationsEnabled} onChange={() => set('notificationsEnabled')(!prefs.notificationsEnabled)} />
        </Row>
        <Row label="Show archived semesters" hint="Include archived classes in views.">
          <Toggle on={!!prefs.showArchived} onChange={() => set('showArchived')(!prefs.showArchived)} />
        </Row>
        <Row
          label="Extra board columns"
          hint="Add Backlog & Planning to the To-Do and class boards (default is Not Started · In Progress · Done)."
        >
          <Toggle on={!!prefs.boardExtraColumns} onChange={() => set('boardExtraColumns')(!prefs.boardExtraColumns)} />
        </Row>
        <Row label="Hide Planner tab" hint="Remove Planner from the navigation.">
          <Toggle on={!!prefs.hidePlanner} onChange={() => set('hidePlanner')(!prefs.hidePlanner)} />
        </Row>
      </Section>

      <PodcastVoicesSection prefs={prefs} set={set} />
      <SettingsGraduationSection />
      <LmsConnections />
      <CanvasAdminConfig />
      <GoogleCalendarSection />
    </>
  );
}

/* ---- Google Calendar sync ---------------------------------------------- */
function GoogleCalendarSection() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const reload = () => gcalApi.status().then(setStatus).catch(() => setStatus({ available: false }));
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const justConnected = new URLSearchParams(window.location.search).get('gcal') === 'connected';

  const connect = async () => {
    setError('');
    setBusy(true);
    try {
      const { url, state } = await gcalApi.authUrl();
      beginConnect({ provider: 'google_calendar', url, state, domain: null });
    } catch (err) {
      setError(errorMessage(err, 'Could not start the Google Calendar connection.'));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Google Calendar? Synced events stay in your calendar.')) return;
    setBusy(true);
    try {
      setStatus(await gcalApi.disconnect());
      setToast({ type: 'success', msg: 'Google Calendar disconnected' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    try {
      setStatus(await gcalApi.setEnabled(!status.syncEnabled));
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err) });
    }
  };

  const sync = async () => {
    setSyncing(true);
    setToast({ loading: true, msg: 'Syncing to Google Calendar…' });
    try {
      const result = await gcalApi.sync();
      setStatus(await gcalApi.status());
      setToast({ type: 'success', msg: summarizeGcalSync(result) });
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, 'Google Calendar sync failed') });
    } finally {
      setSyncing(false);
    }
  };

  const lastSynced = status?.syncedAt
    ? new Date(status.syncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'never';

  return (
    <Section title="Google Calendar" description="Push your assignments and due dates to Google Calendar.">
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      {justConnected && status?.connected && (
        <div className="mb-3 rounded-2xl border border-emerald-300/50 bg-emerald-50/70 px-4 py-2.5 text-sm font-medium text-emerald-700">
          Google Calendar connected — you can now sync your assignments.
        </div>
      )}

      {!status ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !status.available ? (
        <p className="text-sm text-muted">
          Google Calendar isn’t configured on this server yet. An admin needs to set the Google
          Calendar client credentials and the token encryption key.
        </p>
      ) : status.connected ? (
        <div className="space-y-1">
          <Row label="Sync assignments to Google Calendar" hint="Summit is the source of truth.">
            <Toggle on={!!status.syncEnabled} onChange={toggleEnabled} />
          </Row>
          <Row label="Last synced">
            <span className="text-sm text-muted">{lastSynced}</span>
          </Row>
          <div className="flex gap-2 pt-2">
            <button onClick={sync} disabled={syncing || !status.syncEnabled} className="btn btn-primary">
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button onClick={disconnect} disabled={busy} className="btn btn-soft">
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <button onClick={connect} disabled={busy} className="btn btn-primary">
          {busy ? 'Redirecting…' : 'Connect Google Calendar'}
        </button>
      )}
      <Toast toast={toast} />
    </Section>
  );
}

/* ---- LMS integrations (Canvas, Blackboard, Google Classroom, …) -------- */
function LmsConnections() {
  const [providers, setProviders] = useState(null);
  const [toast, setToast] = useState(null);

  const reload = () => lmsStatusAll().then(setProviders).catch(() => setProviders([]));

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Which provider, if any, just completed an OAuth redirect (?lms=<provider>).
  const justConnected = new URLSearchParams(window.location.search).get('lms');

  return (
    <Section
      title="Connected learning platforms"
      description="Link an LMS to auto-import assignments, due dates, and grades."
    >
      <div className="space-y-4">
        {providers === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          providers.map((p) => (
            <ProviderCard
              key={p.provider}
              status={p}
              justConnected={justConnected === p.provider}
              onChange={reload}
              setToast={setToast}
            />
          ))
        )}
      </div>
      <Toast toast={toast} />
    </Section>
  );
}

function ProviderCard({ status, justConnected, onChange, setToast }) {
  const { refreshUser } = useAuth();
  const provider = status.provider;
  const meta = LMS_META[provider] || {};
  const label = status.label || meta.label || provider;
  const api = lmsApi(provider);

  const [domain, setDomain] = useState(status.domain || '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const fmt = (d) =>
    d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const lastSynced = fmt(status.syncedAt) || 'never';

  // Connect by pasting a personal API token (Canvas) — no OAuth redirect.
  const connectToken = async () => {
    setError('');
    const d = domain.trim();
    if (status.needsDomain && !d) {
      return setError(`Enter your school's ${meta.domainLabel || `${label} address`}.`);
    }
    if (!token.trim()) return setError(`Paste your ${label} access token.`);
    setBusy(true);
    try {
      const res = await api.connectToken({ domain: status.needsDomain ? d : undefined, token: token.trim() });
      await refreshUser();
      setToken('');
      setToast({
        type: 'success',
        msg: res.sync ? summarizeSync(res.sync, provider) : `${label} connected`,
      });
      onChange();
    } catch (err) {
      setError(errorMessage(err, `Could not connect ${label}.`));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setError('');
    const d = domain.trim();
    if (status.needsDomain && !d) {
      return setError(`Enter your school's ${meta.domainLabel || `${label} address`}.`);
    }
    setBusy(true);
    try {
      const { url, state } = await api.authUrl(status.needsDomain ? d : undefined);
      beginConnect({ provider, url, state, domain: status.needsDomain ? d : null });
    } catch (err) {
      setError(errorMessage(err, `Could not start the ${label} connection.`));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm(`Disconnect ${label}? Synced assignments stay, but syncing stops.`)) return;
    setBusy(true);
    try {
      await api.disconnect();
      await refreshUser();
      setToast({ type: 'success', msg: `${label} disconnected` });
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setToast({ loading: true, msg: `Syncing assignments from ${label}…` });
    try {
      const result = await api.sync();
      await refreshUser();
      setToast({ type: 'success', msg: summarizeSync(result, provider) });
      onChange();
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, `${label} sync failed`) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/50 bg-white/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.accent || '#6366f1' }} />
        <h3 className="font-display text-base font-bold text-ink">{label}</h3>
        {status.connected && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-600">
            ✓ Connected
          </span>
        )}
      </div>

      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      {justConnected && status.connected && (
        <div className="mb-3 rounded-2xl border border-emerald-300/50 bg-emerald-50/70 px-4 py-2.5 text-sm font-medium text-emerald-700">
          {label} connected — you can now sync assignments.
        </div>
      )}

      {!status.available && !status.supportsTokenAuth ? (
        <p className="text-sm text-muted">
          {label} isn’t configured on this server yet. An admin needs to set the {label} client
          credentials and the token encryption key.
        </p>
      ) : status.connected ? (
        <div className="space-y-2">
          {status.domain && <p className="text-xs text-muted">{status.domain}</p>}
          {/* Synced-data counts */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span><span className="font-bold text-ink">{status.assignmentsSynced ?? 0}</span> assignments</span>
            <span><span className="font-bold text-ink">{status.gradesSynced ?? 0}</span> grades</span>
            {status.authMethod && (
              <span className="capitalize">via {status.authMethod === 'token' ? 'API token' : 'OAuth'}</span>
            )}
          </div>
          <p className="text-xs text-muted">Last synced: {lastSynced}</p>
          {status.lastSync?.status === 'error' && (
            <p className="text-xs font-medium text-rose-500">Last sync failed: {status.lastSync.error || 'unknown error'}</p>
          )}
          {status.nextSyncEta && (
            <p className="text-xs text-muted">Next auto-sync: {fmt(status.nextSyncEta)}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={sync} disabled={syncing} className="btn btn-primary">
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button onClick={disconnect} disabled={busy} className="btn btn-soft">
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {status.needsDomain && (
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink">{meta.domainLabel || `${label} web address`}</span>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={meta.domainPlaceholder || ''}
                className="field"
                autoCapitalize="none"
                autoCorrect="off"
              />
              {meta.domainHelp && <span className="mt-1 block text-xs text-muted">{meta.domainHelp}</span>}
            </label>
          )}

          {/* Preferred: OAuth (only when the server has client credentials). */}
          {status.available && (
            <button onClick={connect} disabled={busy} className="btn btn-primary">
              {busy ? 'Redirecting…' : `Connect ${label}`}
            </button>
          )}

          {/* Personal-access-token connect (Canvas). Shown as the alternative
              when OAuth is available, or the primary path when it isn't. */}
          {status.supportsTokenAuth && (
            <div className="space-y-2">
              {status.available && (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="h-px flex-1 bg-white/40" />or<span className="h-px flex-1 bg-white/40" />
                </div>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink">Access token</span>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={`Paste your ${label} access token`}
                  className="field"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                />
                {meta.tokenHelp && <span className="mt-1 block text-xs text-muted">{meta.tokenHelp}</span>}
              </label>
              <button onClick={connectToken} disabled={busy} className={status.available ? 'btn btn-soft' : 'btn btn-primary'}>
                {busy ? 'Connecting…' : `Connect with token`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Canvas configuration (admin only) --------------------------------- */
function CanvasAdminConfig() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [cfg, setCfg] = useState(null); // presence-flags view from the server
  const [form, setForm] = useState({ instanceUrl: '', clientId: '', clientSecret: '', encryptionKey: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    api
      .get('/api/admin/canvas-config')
      .then((r) => {
        const c = r.data.config;
        setCfg(c);
        setForm((f) => ({ ...f, instanceUrl: c.instanceUrl || '', clientId: c.clientId || '' }));
      })
      .catch(() => setCfg(null))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!isAdmin) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // openssl rand -hex 32 equivalent, generated client-side.
  const generateKey = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    setForm((f) => ({ ...f, encryptionKey: hex }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { instanceUrl: form.instanceUrl.trim(), clientId: form.clientId.trim() };
      if (form.clientSecret.trim()) payload.clientSecret = form.clientSecret.trim();
      // Only send a key when none is set yet (write-once; the server enforces this too).
      if (!cfg?.hasEncryptionKey && form.encryptionKey.trim()) payload.encryptionKey = form.encryptionKey.trim();
      const r = await api.post('/api/admin/canvas-config', payload);
      setCfg(r.data.config);
      setForm((f) => ({ ...f, clientSecret: '', encryptionKey: '' }));
      setToast({ type: 'success', msg: 'Canvas configured successfully' });
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, 'Could not save Canvas configuration') });
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving;

  return (
    <Section title="Canvas configuration" description="Server-wide Canvas OAuth settings for the whole app (admin only).">
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : cfg?.configured ? (
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-600">
          ✓ Canvas is configured
        </p>
      ) : (
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-sm font-bold text-rose-600">
          ⚠ Canvas is not configured yet
        </p>
      )}

      <div className="space-y-4">
        <Field
          label="Canvas Instance URL"
          value={form.instanceUrl}
          onChange={set('instanceUrl')}
          placeholder="https://canvas.myuniversity.com"
          disabled={busy}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <Field
          label="OAuth Client ID"
          value={form.clientId}
          onChange={set('clientId')}
          placeholder="e.g. 10000000000001"
          disabled={busy}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <Field
          label="OAuth Client Secret"
          type="password"
          value={form.clientSecret}
          onChange={set('clientSecret')}
          placeholder={cfg?.hasClientSecret ? '•••••••• saved — leave blank to keep' : 'Paste the client secret'}
          disabled={busy}
          autoComplete="off"
        />

        {/* Token encryption key — read-only display + generate (write-once). */}
        <div>
          <span className="mb-1 block text-sm font-semibold text-ink">Token Encryption Key</span>
          {cfg?.hasEncryptionKey ? (
            <div className="flex items-center gap-2">
              <input readOnly value="•••••••••••••••••••• configured" className="field font-mono text-muted" />
              <span className="whitespace-nowrap text-xs font-semibold text-emerald-600">🔒 Locked</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={form.encryptionKey}
                placeholder="Click Generate to create a 64-char key"
                className="field font-mono text-xs"
              />
              <button type="button" onClick={generateKey} disabled={busy} className="btn btn-soft whitespace-nowrap">
                Generate Key
              </button>
            </div>
          )}
          <span className="mt-1 block text-xs text-muted">
            {cfg?.hasEncryptionKey
              ? 'Write-once — it can’t be replaced here, since that would make all existing encrypted tokens and 2FA secrets unreadable.'
              : 'Generated in your browser. Also set it as the server’s APP_ENCRYPTION_KEY — the running server reads the key from the environment.'}
          </span>
        </div>

        <div className="rounded-xl border border-amber-300/50 bg-amber-50/60 px-3 py-2 text-xs text-amber-700">
          These values are stored for reference. The running server still reads Canvas credentials and the encryption
          key from environment variables, so changes take effect once they’re set in the server env and it’s redeployed.
        </div>

        <button type="button" onClick={save} disabled={busy} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
      </div>

      <Toast toast={toast} />
    </Section>
  );
}

/* ---- Color theme picker (lives in the Display tab) --------------------- */
const THEMES = [
  { value: 'default', label: 'Default', sub: 'Coral / Teal', grad: 'linear-gradient(135deg, #ff8a4c 0%, #ff6f73 45%, #4f9fd6 100%)' },
  { value: 'ocean', label: 'Ocean Blue', sub: 'Deep sea', grad: 'linear-gradient(135deg, #011c40 0%, #26658c 50%, #54acbf 100%)' },
  { value: 'forest', label: 'Forest Green', sub: 'Woodland', grad: 'linear-gradient(135deg, #051f20 0%, #235367 50%, #8eb69b 100%)' },
  { value: 'sunset', label: 'Sunset Orange', sub: 'Warm dusk', grad: 'linear-gradient(135deg, #951a21 0%, #d55123 50%, #e47a24 100%)' },
];

function ThemePicker({ prefs, set }) {
  const current = prefs.colorScheme || 'default';
  return (
    <div className="border-b border-white/40 py-3">
      <div className="mb-2.5 text-sm font-semibold text-ink">Color theme</div>
      <div role="radiogroup" aria-label="Color theme" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {THEMES.map((t) => {
          const active = current === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={t.sub}
              onClick={() => set('colorScheme')(t.value)}
              className={`relative flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 transition ${
                active ? 'border-brand-400 bg-white/70 ring-2 ring-brand-400' : 'border-white/50 bg-white/40 hover:-translate-y-0.5 hover:bg-white/70'
              }`}
            >
              <span className="h-10 w-full rounded-lg shadow-sm" style={{ backgroundImage: t.grad }} />
              <span className="text-[11px] font-semibold text-ink">{t.label}</span>
              {active && (
                <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] font-bold shadow" style={{ color: 'var(--color-brand-600)' }}>
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Display ----------------------------------------------------------- */
function DisplayTab({ prefs, set }) {
  return (
    <>
      <Section title="Display" description="Personalize the look and feel — changes apply instantly.">
        <Row label="Theme" hint="Light, Dark, or match your system.">
          <select value={prefs.theme} onChange={(e) => set('theme')(e.target.value)} className="field !w-auto">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="auto">Auto (system)</option>
          </select>
        </Row>
        <ThemePicker prefs={prefs} set={set} />
        <Row label="Font size">
          <RadioGroup
            name="fontsize"
            value={prefs.fontSize}
            onChange={set('fontSize')}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'normal', label: 'Normal' },
              { value: 'large', label: 'Large' },
            ]}
          />
        </Row>
        <Row label="Compact mode" hint="Reduce spacing and padding across the UI.">
          <Toggle on={!!prefs.compactMode} onChange={() => set('compactMode')(!prefs.compactMode)} />
        </Row>
      </Section>

      <Section title="Preview" description="A live sample using your current settings.">
        <Preview />
      </Section>
    </>
  );
}

function Preview() {
  const gradient = classGradient(null, 0);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Mini class card */}
      <div className="glass-card relative overflow-hidden p-5">
        <span className="pointer-events-none absolute inset-0 opacity-[0.22]" style={{ backgroundImage: gradient }} />
        <span className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full opacity-70 blur-2xl" style={{ backgroundImage: gradient }} />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="h-10 w-1.5 rounded-full" style={{ backgroundImage: gradient }} />
            <div>
              <h3 className="font-bold text-ink">Calculus II</h3>
              <p className="text-xs text-muted">MATH 102 · Fall 2026</p>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-extrabold ${gradeColor(92)}`}>92%</div>
            <div className="text-xs text-muted">A-</div>
          </div>
        </div>
      </div>

      {/* Mini calendar snippet */}
      <div className="glass-card p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-ink">This week</span>
          <span className="text-xs text-muted">Sep 7–11</span>
        </div>
        <div className="space-y-1.5">
          {[
            { t: 'Problem Set 3', p: 'bg-rose-500', tag: 'due' },
            { t: 'Lab report', p: 'bg-orange-400', tag: 'plan' },
            { t: 'Reading', p: 'bg-slate-400', tag: 'due' },
          ].map((r) => (
            <div key={r.t} className="flex items-center gap-2 rounded-lg border border-white/50 bg-white/45 px-2 py-1.5">
              <span className={`h-2 w-2 rounded-full ${r.p}`} />
              <span className="flex-1 truncate text-xs font-semibold text-ink">{r.t}</span>
              <span className="text-[9px] font-semibold uppercase text-muted">{r.tag}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---- Shared inputs ----------------------------------------------------- */
function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      <input {...props} className="field" />
    </label>
  );
}

function RadioGroup({ name, value, onChange, options }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
            value === o.value ? 'text-white shadow-sm' : 'bg-white/55 text-muted hover:bg-white/80'
          }`}
          style={value === o.value ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
          aria-pressed={value === o.value}
          aria-label={`${name}: ${o.label}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
