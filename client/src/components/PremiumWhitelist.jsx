import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ErrorBanner, Spinner } from './ui';

/**
 * Admin tool to grant comp premium access to specific users (close friends /
 * testers) without a subscription. Lives on the /admin dashboard.
 */
export function PremiumWhitelist() {
  const [list, setList] = useState(null);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/admin/whitelist');
      setList(data.whitelisted);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/admin/whitelist/add', { email: email.trim(), reason: reason.trim() || undefined });
      setEmail('');
      setReason('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entryEmail) => {
    if (!confirm(`Remove ${entryEmail} from the premium whitelist?`)) return;
    try {
      await api.post('/api/admin/whitelist/remove', { email: entryEmail });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="glass-panel p-5">
      <h2 className="text-lg font-bold text-ink">Premium whitelist</h2>
      <p className="text-sm text-muted">Grant full premium access to specific users (no subscription needed).</p>

      <form onSubmit={add} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          className="field sm:flex-1"
          placeholder="user@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="field sm:flex-1"
          placeholder="Reason (e.g. close friend, beta tester)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !email.trim()}>
          {busy ? 'Adding…' : 'Add to whitelist'}
        </button>
      </form>

      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}

      <div className="mt-4">
        {list === null ? (
          <Spinner label="Loading whitelist…" />
        ) : list.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No whitelisted users yet.</p>
        ) : (
          <ul className="divide-y divide-white/40">
            {list.map((w) => (
              <li key={w.userId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{w.name || w.email}</p>
                  <p className="truncate text-xs text-muted">
                    {w.email}{w.reason ? ` · ${w.reason}` : ''} · {new Date(w.whitelistedAt).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => remove(w.email)} className="btn btn-soft shrink-0 !px-3 !py-1 text-rose-600">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
