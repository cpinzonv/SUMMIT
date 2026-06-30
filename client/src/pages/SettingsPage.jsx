import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../api/client';
import { ErrorBanner, Toast, Toggle, classGradient, gradeColor } from '../components/ui';
import { canvasApi, beginConnect, summarizeSync } from '../lib/canvas';

const TABS = [
  { key: 'account', label: 'Account' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'display', label: 'Display' },
];

export default function SettingsPage() {
  const { user, preferences, savePreferences } = useAuth();
  // Land on Preferences (where Canvas lives) when returning from the OAuth redirect.
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).has('canvas') ? 'preferences' : 'account',
  );
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

      <Section title="Session" description="Sign out of Summit on this device.">
        <button onClick={handleLogout} className="btn btn-soft">
          Log out
        </button>
      </Section>
    </>
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

      <CanvasSection />
    </>
  );
}

/* ---- Canvas integration ------------------------------------------------ */
function CanvasSection() {
  const { user, refreshUser } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState(user?.lms || { connected: false, available: true });
  const [domain, setDomain] = useState(user?.lms?.domain || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Pull fresh status (includes server `available` flag) on mount.
  useEffect(() => {
    canvasApi
      .status()
      .then((s) => {
        setStatus(s);
        if (s.domain) setDomain(s.domain);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const justConnected = new URLSearchParams(location.search).get('canvas') === 'connected';

  const connect = async () => {
    setError('');
    const d = domain.trim();
    if (!d) return setError("Enter your school's Canvas web address, e.g. school.instructure.com.");
    setBusy(true);
    try {
      const { url, state } = await canvasApi.authUrl(d);
      beginConnect({ url, state, domain: d }); // redirects to Canvas
    } catch (err) {
      setError(errorMessage(err, 'Could not start the Canvas connection.'));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Canvas? Synced assignments stay, but syncing stops.')) return;
    setBusy(true);
    try {
      const s = await canvasApi.disconnect();
      setStatus(s);
      await refreshUser();
      setToast({ type: 'success', msg: 'Canvas disconnected' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setToast({ loading: true, msg: 'Syncing assignments…' });
    try {
      const result = await canvasApi.sync();
      await refreshUser();
      const s = await canvasApi.status();
      setStatus(s);
      setToast({ type: 'success', msg: summarizeSync(result) });
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, 'Sync failed') });
    }
  };

  const lastSynced = status.syncedAt
    ? new Date(status.syncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'never';

  return (
    <Section title="Canvas" description="Connect your Canvas account to auto-import assignments.">
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      {justConnected && status.connected && (
        <div className="mb-3 rounded-2xl border border-emerald-300/50 bg-emerald-50/70 px-4 py-3 text-sm font-medium text-emerald-700">
          Canvas connected — you can now sync assignments.
        </div>
      )}

      {!status.available ? (
        <p className="text-sm text-muted">
          Canvas isn’t configured on this server yet. An admin needs to set the Canvas
          developer key and token encryption key.
        </p>
      ) : status.connected ? (
        <div className="space-y-3">
          <Row label="Status" hint={status.domain || undefined}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-600">
              ✓ Connected
            </span>
          </Row>
          <Row label="Last synced" hint="Imports new and updated assignments.">
            <span className="text-sm text-muted">{lastSynced}</span>
          </Row>
          <div className="flex gap-2 pt-1">
            <button onClick={sync} disabled={!!toast?.loading} className="btn btn-primary">
              {toast?.loading ? 'Syncing…' : 'Sync now'}
            </button>
            <button onClick={disconnect} disabled={busy} className="btn btn-soft">
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">Canvas web address</span>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="school.instructure.com"
              className="field"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <span className="mt-1 block text-xs text-muted">
              The address you use to log into Canvas (e.g. <code>asu.instructure.com</code>).
            </span>
          </label>
          <button onClick={connect} disabled={busy} className="btn btn-primary">
            {busy ? 'Redirecting…' : 'Connect Canvas'}
          </button>
        </div>
      )}
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
