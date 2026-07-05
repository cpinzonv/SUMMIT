import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { Modal, Toast, Spinner, ErrorBanner } from '../components/ui';
import { institutionAdminApi, parseRoster, inviteLink, FEATURES, STATUS_STYLES } from '../lib/institutions';

const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

/**
 * Institution-admin (school IT) dashboard — their own institution only. Shows
 * contract + enabled features (read-only), the student roster, and a CSV/paste
 * roster upload that provisions accounts + returns set-password invite links.
 */
export default function InstitutionDashboardPage() {
  const [data, setData] = useState(null); // { institution, students }
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = () => institutionAdminApi.overview().then(setData).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (error && !data) return <div className="mx-auto max-w-3xl p-6"><ErrorBanner message={error} /></div>;
  if (!data) return <Spinner label="Loading your institution…" />;

  const { institution: inst, students } = data;
  const enabled = FEATURES.filter((f) => inst.featureFlags?.[f.key]);
  const overCap = inst.studentSeats > 0 && students.length > inst.studentSeats;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{inst.name}</h1>
        <p className="text-sm text-muted">Institution administration</p>
      </div>

      <ErrorBanner message={error} />

      {/* Overview */}
      <div className="glass-card grid gap-4 p-5 sm:grid-cols-3">
        <Info label="Status">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_STYLES[inst.status] || 'bg-slate-100 text-slate-600'}`}>{inst.status}</span>
        </Info>
        <Info label="Contract">{fmtDate(inst.contractStart)} – {fmtDate(inst.contractEnd)}</Info>
        <Info label="Plan"><span className="capitalize">{inst.tier}</span></Info>
        <Info label="Seats">
          <span className={overCap ? 'font-bold text-rose-600' : 'font-bold text-ink'}>{students.length}</span>
          <span className="text-muted"> / {inst.studentSeats || '∞'}</span>
          {overCap && <span className="ml-2 text-xs font-semibold text-rose-600">over seat count</span>}
        </Info>
        <Info label="Enabled features" wide>
          <div className="flex flex-wrap gap-1.5">
            {enabled.length === 0 ? <span className="text-sm text-muted">None</span> : enabled.map((f) => (
              <span key={f.key} className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{f.label}</span>
            ))}
          </div>
        </Info>
      </div>

      {/* Roster */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Students ({students.length})</h2>
          <button onClick={() => setAddOpen(true)} className="btn btn-primary">+ Add students</button>
        </div>
        {students.length === 0 ? (
          <div className="glass-card p-8 text-center text-sm text-muted">No students yet. Upload a roster to provision accounts.</div>
        ) : (
          <div className="glass-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/50 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Student</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Added</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b border-white/30 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-ink">{s.name}</div>
                      <div className="text-xs text-muted">{s.email}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${s.activated ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-100 text-amber-700'}`}>
                        {s.activated ? 'Active' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{fmtDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addOpen && (
        <AddStudentsModal
          onClose={() => setAddOpen(false)}
          onDone={(msg) => { setToast({ type: 'success', msg }); load(); }}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

function Info({ label, children, wide }) {
  return (
    <div className={wide ? 'sm:col-span-3' : ''}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

/* ---- Add students (CSV / paste) ---------------------------------------- */
function AddStudentsModal({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { created:[{email,inviteToken}], skipped }

  const parsed = parseRoster(text);

  const readFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText((t) => (t ? `${t}\n` : '') + String(reader.result || ''));
    reader.readAsText(file);
  };

  const submit = async () => {
    setError('');
    if (parsed.length === 0) return setError('Add at least one valid email (one per line, optionally "email, Name").');
    setBusy(true);
    try {
      const res = await institutionAdminApi.uploadRoster(parsed);
      setResult(res);
    } catch (err) {
      setError(errorMessage(err, 'Could not upload the roster.'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title="Roster uploaded" onClose={() => { onDone(`${result.created.length} student${result.created.length === 1 ? '' : 's'} added`); onClose(); }} wide>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink">{result.created.length}</span> created
            {result.skipped.length > 0 && <> · <span className="font-semibold text-ink">{result.skipped.length}</span> skipped (already existed)</>}.
            Send each student their set-password link (expires in 72h).
          </p>
          {result.created.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-white/60">
              <table className="w-full text-xs">
                <tbody>
                  {result.created.map((c) => (
                    <tr key={c.email} className="border-b border-white/40 last:border-0">
                      <td className="px-3 py-1.5 font-semibold text-ink">{c.email}</td>
                      <td className="px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(inviteLink(c.inviteToken))}
                          className="font-semibold text-brand-600 hover:underline"
                          title={inviteLink(c.inviteToken)}
                        >
                          Copy invite link
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => { onDone(`${result.created.length} student${result.created.length === 1 ? '' : 's'} added`); onClose(); }} className="btn btn-primary">Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add students" onClose={onClose} wide>
      <div className="space-y-3">
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        <p className="text-sm text-muted">Paste a roster — one student per line: <span className="font-mono">email, Name</span> (name optional). Or load a .csv/.txt file.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={'ada@school.edu, Ada Lovelace\nalan@school.edu, Alan Turing'}
          className="field font-mono text-sm"
        />
        <div className="flex items-center justify-between">
          <label className="cursor-pointer text-sm font-semibold text-brand-600 hover:underline">
            Load .csv / .txt
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={readFile} />
          </label>
          <span className="text-xs text-muted">{parsed.length} valid email{parsed.length === 1 ? '' : 's'} detected</span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || parsed.length === 0} className="btn btn-primary">
            {busy ? 'Provisioning…' : `Add ${parsed.length || ''} student${parsed.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
