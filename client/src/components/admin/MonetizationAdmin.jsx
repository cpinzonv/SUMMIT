import { useCallback, useEffect, useState } from 'react';
import { billingApi } from '../../api/billing';
import { api, errorMessage } from '../../api/client';
import { Spinner, Toggle, ConfirmModal, Toast } from '../ui';

/** Admin → Monetization. Master paywall toggle, founding members, waitlist,
 *  and gate (conversion-intent) analytics. Fake-door until BILLING_ENABLED. */

function Panel({ title, subtitle, children, right }) {
  return (
    <div className="glass-panel p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

const GATE_COLS = ['shown', 'claimed_founding', 'joined_waitlist', 'dismissed', 'upgraded'];

export default function MonetizationAdmin() {
  const [flags, setFlags] = useState(null);
  const [founding, setFounding] = useState(null);
  const [waitlist, setWaitlist] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmOn, setConfirmOn] = useState(false);
  const [capDraft, setCapDraft] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, fm, wl] = await Promise.all([
        billingApi.admin.flags(),
        billingApi.admin.founding(),
        billingApi.admin.waitlist(),
      ]);
      setFlags(f);
      setFounding(fm);
      setCapDraft(String(fm.cap));
      setWaitlist(wl);
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, 'Could not load monetization data.') });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const params = {};
      if (range.from) params.from = range.from;
      if (range.to) params.to = new Date(new Date(range.to).getTime() + 86400000).toISOString().slice(0, 10);
      setAnalytics(await billingApi.admin.gateAnalytics(params));
    } catch {
      /* non-fatal */
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  const paywallOn = Boolean(flags?.paywall_enabled?.enabled);
  const billingEnabled = Boolean(flags?.billing_enabled);

  const setPaywall = async (enabled) => {
    try {
      await billingApi.admin.setFlag('paywall_enabled', { enabled });
      setToast({ type: 'success', msg: enabled ? 'Paywall set to REAL mode.' : 'Paywall set to fake-door.' });
      load();
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, 'Could not update the flag.') });
    }
  };

  const togglePaywall = () => {
    if (!paywallOn) setConfirmOn(true); // turning ON needs confirmation
    else setPaywall(false);
  };

  const saveCap = async () => {
    const cap = Number(capDraft);
    if (!Number.isInteger(cap) || cap < 0) return;
    try {
      await billingApi.admin.setFlag('founding_member_cap', { cap });
      setToast({ type: 'success', msg: `Founding cap set to ${cap}.` });
      load();
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, 'Could not update the cap.') });
    }
  };

  const downloadCsv = async () => {
    try {
      const res = await api.get(billingApi.admin.waitlistCsvUrl, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'summit-waitlist.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, 'Could not export CSV.') });
    }
  };

  if (loading) return <Spinner label="Loading monetization…" />;

  const maxShown = Math.max(1, ...(analytics?.gates || []).map((g) => g.total));

  return (
    <div className="space-y-6">
      {/* Master toggle */}
      <Panel
        title="Paywall mode"
        subtitle="Fake-door collects founding members + waitlist. Real mode shows checkout."
        right={<Toggle on={paywallOn} onChange={togglePaywall} />}
      >
        <p className="text-sm text-ink">
          Currently <span className="font-bold">{paywallOn ? 'REAL (checkout shown)' : 'FAKE-DOOR (no charges)'}</span>.
          {flags?.paywall_enabled?.updated_at && (
            <span className="text-muted"> · last changed {new Date(flags.paywall_enabled.updated_at).toLocaleString()}</span>
          )}
        </p>
        {!billingEnabled && (
          <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
            Master kill switch (BILLING_ENABLED) is OFF — checkout cannot activate regardless of this toggle.
          </div>
        )}
      </Panel>

      {/* Founding members */}
      <Panel
        title="Founding members"
        subtitle={`${founding?.claimed ?? 0} / ${founding?.cap ?? 0} claimed`}
        right={
          <div className="flex items-center gap-2">
            <input
              className="field w-24 text-sm"
              value={capDraft}
              onChange={(e) => setCapDraft(e.target.value.replace(/[^0-9]/g, ''))}
              aria-label="Founding member cap"
            />
            <button className="btn btn-soft" onClick={saveCap} disabled={String(founding?.cap) === capDraft}>
              Save cap
            </button>
          </div>
        }
      >
        <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-white/50">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, ((founding?.claimed ?? 0) / Math.max(1, founding?.cap ?? 1)) * 100)}%`,
              backgroundImage: 'var(--grad-teal-purple)',
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-xl border border-white/50">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-white/50">
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2">Pro until</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              {(founding?.members || []).map((m) => (
                <tr key={m.number}>
                  <td className="px-4 py-2 font-semibold text-ink">{m.number}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{m.name}</div>
                    <div className="text-xs text-muted">{m.email}</div>
                  </td>
                  <td className="px-4 py-2 text-muted">{m.pro_until ? new Date(m.pro_until).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Waitlist */}
      <Panel
        title="Waitlist"
        subtitle={`${waitlist?.count ?? 0} signups`}
        right={<button className="btn btn-soft" onClick={downloadCsv} disabled={!waitlist?.count}>Export CSV</button>}
      >
        {waitlist?.count ? (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-white/50">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-white/50">
                  <th className="px-4 py-2">Person</th>
                  <th className="px-4 py-2">Interested in</th>
                  <th className="px-4 py-2">From gate</th>
                  <th className="px-4 py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/40">
                {waitlist.entries.map((w, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-ink">{w.name}</div>
                      <div className="text-xs text-muted">{w.email}</div>
                    </td>
                    <td className="px-4 py-2 text-muted">{w.interested_tier || '—'}</td>
                    <td className="px-4 py-2 text-muted">{w.source_gate || '—'}</td>
                    <td className="px-4 py-2 text-muted">{new Date(w.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No waitlist signups yet.</p>
        )}
      </Panel>

      {/* Gate analytics */}
      <Panel
        title="Gate analytics"
        subtitle="Conversion intent per gate"
        right={
          <div className="flex items-center gap-2 text-sm">
            <input type="date" className="field" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From date" />
            <span className="text-muted">to</span>
            <input type="date" className="field" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To date" />
          </div>
        }
      >
        {analytics?.gates?.length ? (
          <div className="space-y-4">
            {analytics.gates.map((g) => (
              <div key={g.gate}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-ink">{g.gate}</span>
                  <span className="text-muted">{g.total} events</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/50">
                  <div className="h-full rounded-full" style={{ width: `${(g.total / maxShown) * 100}%`, backgroundImage: 'var(--grad-teal-purple)' }} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                  {GATE_COLS.map((c) => (
                    <span key={c}>{c.replace(/_/g, ' ')}: <span className="font-semibold text-ink">{g[c]}</span></span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No gate events in this range.</p>
        )}
      </Panel>

      {confirmOn && (
        <ConfirmModal
          title="Turn on the real paywall?"
          message="This will show real checkout to users and begin charging when Stripe is connected. Are you sure?"
          confirmLabel="Turn on"
          onConfirm={() => { setConfirmOn(false); setPaywall(true); }}
          onClose={() => setConfirmOn(false)}
        />
      )}
      {toast && <Toast toast={toast} />}
    </div>
  );
}
