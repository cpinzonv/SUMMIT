import { useEffect, useState } from 'react';
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

      <ChangePassword />

      <TwoFactorSection user={user} />

      <Section title="Session" description="Sign out of Summit on this device.">
        <button onClick={handleLogout} className="btn btn-soft">
          Log out
        </button>
      </Section>
    </>
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
  const [step, setStep] = useState('loading'); // loading | scan | backup
  const [data, setData] = useState(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .post('/api/user/2fa/setup')
      .then((r) => { setData(r.data); setStep('scan'); })
      .catch((err) => setError(errorMessage(err, 'Could not start 2FA setup.')));
  }, []);

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
      {step === 'scan' && !data && <ErrorBanner message={error} />}
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
      </Section>

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

/* ---- Display ----------------------------------------------------------- */
const COLOR_SCHEMES = [
  { value: 'default', label: 'Default (Coral / Teal)', enabled: true },
  { value: 'ocean', label: 'Ocean Blue', enabled: false },
  { value: 'forest', label: 'Forest Green', enabled: false },
  { value: 'sunset', label: 'Sunset Orange', enabled: false },
];

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
        <Row label="Color scheme">
          <select value={prefs.colorScheme} onChange={(e) => set('colorScheme')(e.target.value)} className="field !w-auto">
            {COLOR_SCHEMES.map((c) => (
              <option key={c.value} value={c.value} disabled={!c.enabled}>
                {c.label}{c.enabled ? '' : ' — Coming soon'}
              </option>
            ))}
          </select>
        </Row>
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
