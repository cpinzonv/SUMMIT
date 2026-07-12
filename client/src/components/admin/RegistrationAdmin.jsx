import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Spinner, ErrorBanner, Toast, Toggle } from '../ui';

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

function InviteLink({ code }) {
  const url = `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(url)}
      className="font-mono text-xs text-brand-600 hover:underline"
      title="Copy invite link"
    >
      copy link
    </button>
  );
}

/** Admin: gated-registration mode, launch waitlist, and invite-code management. */
export default function RegistrationAdmin() {
  const [status, setStatus] = useState(null); // { mode, waitlist: { total, byUniversity } }
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [showMode, setShowMode] = useState(false);
  const [form, setForm] = useState({ maxUses: '1', prefix: 'FOUNDING', note: '', expiresAt: '' });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setError('');
    try {
      const [s, c] = await Promise.all([
        api.get('/api/admin/registration'),
        api.get('/api/admin/invite-codes'),
      ]);
      setStatus(s.data);
      setCodes(c.data.codes);
    } catch (err) {
      setError(errorMessage(err, 'Could not load registration data.'));
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const createCode = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const payload = {
        maxUses: Math.max(1, Number(form.maxUses) || 1),
        ...(form.prefix.trim() ? { prefix: form.prefix.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
      };
      const { data } = await api.post('/api/admin/invite-codes', payload);
      setToast({ type: 'success', msg: `Created ${data.code.code}` });
      setForm((f) => ({ ...f, note: '' }));
      load();
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err) });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code) => {
    try {
      await api.post('/api/admin/invite-codes/revoke', { code });
      setToast({ type: 'success', msg: `Revoked ${code}` });
      load();
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err) });
    }
  };

  if (error && !status) return <ErrorBanner message={error} />;
  if (!status || !codes) return <Spinner label="Loading registration…" />;

  const { mode, waitlist } = status;
  const maxUni = Math.max(1, ...waitlist.byUniversity.map((r) => r.count));

  return (
    <div className="space-y-6">
      {toast && <Toast toast={toast} />}
      <ErrorBanner message={error} />

      {/* Registration mode — toggle-visible display of the current REGISTRATION_MODE. */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Registration mode</h2>
            <p className="text-sm text-muted">
              Set by the REGISTRATION_MODE environment variable. Toggle to reveal the current value.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Toggle on={showMode} onChange={() => setShowMode((v) => !v)} />
            {showMode ? (
              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  mode === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {mode === 'open' ? 'Open' : 'Invite only'}
              </span>
            ) : (
              <span className="text-sm font-medium text-muted">Hidden</span>
            )}
          </div>
        </div>
      </div>

      {/* Waitlist */}
      <div className="glass-panel p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-ink">Launch waitlist</h2>
          <p className="font-display text-3xl font-bold text-ink">{waitlist.total}</p>
        </div>
        {waitlist.byUniversity.length === 0 ? (
          <p className="text-sm text-muted">No signups yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">By university</p>
            {waitlist.byUniversity.map((row) => (
              <div key={row.university} className="flex items-center gap-3">
                <span className="w-48 shrink-0 truncate text-sm text-ink" title={row.university}>{row.university}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/50">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(row.count / maxUni) * 100}%`, backgroundImage: 'var(--grad-teal-purple)' }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-sm font-semibold text-muted">{row.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite codes */}
      <div className="glass-panel p-6">
        <h2 className="mb-4 text-lg font-bold text-ink">Invite codes</h2>

        <form onSubmit={createCode} className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">Prefix</span>
            <input className="field" value={form.prefix} onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))} placeholder="FOUNDING" maxLength={20} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">Max uses</span>
            <input className="field" type="number" min="1" value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">Expires (optional)</span>
            <input className="field" type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">Note (optional)</span>
            <input className="field" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={200} placeholder="e.g. spring launch" />
          </label>
          <div className="col-span-2 sm:col-span-4">
            <button type="submit" disabled={creating} className="btn btn-primary">
              {creating ? 'Creating…' : 'Create code'}
            </button>
          </div>
        </form>

        {codes.length === 0 ? (
          <p className="text-sm text-muted">No invite codes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2 pr-4">Code</th>
                  <th className="py-2 pr-4">Uses</th>
                  <th className="py-2 pr-4">Expires</th>
                  <th className="py-2 pr-4">Note</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const revoked = Boolean(c.revoked_at);
                  const exhausted = c.use_count >= c.max_uses;
                  const expired = c.expires_at && new Date(c.expires_at) <= new Date();
                  const active = !revoked && !exhausted && !expired;
                  return (
                    <tr key={c.code} className="border-t border-white/40">
                      <td className="py-2 pr-4">
                        <span className="font-mono font-semibold text-ink">{c.code}</span>{' '}
                        <InviteLink code={c.code} />
                      </td>
                      <td className="py-2 pr-4 text-muted">{c.use_count}/{c.max_uses}</td>
                      <td className="py-2 pr-4 text-muted">{fmtDate(c.expires_at)}</td>
                      <td className="py-2 pr-4 text-muted">{c.note || '—'}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {revoked ? 'Revoked' : exhausted ? 'Used up' : expired ? 'Expired' : 'Active'}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        {!revoked && (
                          <button type="button" onClick={() => revoke(c.code)} className="text-sm font-semibold text-rose-600 hover:underline">
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
