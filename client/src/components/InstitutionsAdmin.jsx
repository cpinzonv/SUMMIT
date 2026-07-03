import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { Modal, Toast, Toggle, Spinner, ErrorBanner } from './ui';
import { institutionsApi, inviteLink, FEATURES, TIER_DEFAULTS, LMS_TYPES, STATUS_STYLES } from '../lib/institutions';

const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

/* ---- Institutions admin (Phase 1) -------------------------------------- */
export function InstitutionsAdmin() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // {type:'create'} | {type:'edit',inst} | {type:'invite',inst,link}
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  const load = () => institutionsApi.list().then(setRows).catch((e) => { setRows([]); setError(errorMessage(e)); });
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const onCreated = ({ institution, inviteToken }) => {
    setModal({ type: 'invite', inst: institution, link: inviteLink(inviteToken) });
    load();
  };
  const revoke = async (inst, revoked) => {
    setConfirmRevoke(null);
    try {
      await institutionsApi.revoke(inst.id, revoked);
      setToast({ type: 'success', msg: revoked ? `${inst.name} access revoked` : `${inst.name} reinstated` });
      load();
    } catch (e) {
      setToast({ type: 'error', msg: errorMessage(e) });
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Institutions</h2>
          <p className="text-sm text-muted">Provision schools, invite their admin, manage contracts.</p>
        </div>
        <button onClick={() => setModal({ type: 'create' })} className="btn btn-primary">+ Create Institution</button>
      </div>

      <ErrorBanner message={error} />

      {rows === null ? (
        <Spinner label="Loading institutions…" />
      ) : rows.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted">No institutions yet. Create the first one.</div>
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/50 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Institution</th>
                <th className="px-4 py-2.5">Contract</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Students</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inst) => (
                <tr key={inst.id} className="border-b border-white/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{inst.name}</div>
                    <div className="text-xs text-muted">{inst.adminEmail} · {inst.tier}{inst.lmsType ? ` · ${inst.lmsType}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{fmtDate(inst.contractStart)} – {fmtDate(inst.contractEnd)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_STYLES[inst.status] || 'bg-slate-100 text-slate-600'}`}>{inst.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-bold text-ink">{inst.studentCount}</span>
                    <span className="text-muted"> / {inst.studentSeats || '∞'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2 text-xs font-semibold">
                      <button onClick={() => setModal({ type: 'edit', inst })} className="text-brand-600 hover:underline">Edit</button>
                      {inst.status === 'revoked' ? (
                        <button onClick={() => revoke(inst, false)} className="text-emerald-600 hover:underline">Reinstate</button>
                      ) : (
                        <button onClick={() => setConfirmRevoke(inst)} className="text-rose-600 hover:underline">Revoke</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(modal?.type === 'create' || modal?.type === 'edit') && (
        <InstitutionForm
          inst={modal.type === 'edit' ? modal.inst : null}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); setToast({ type: 'success', msg }); load(); }}
          onCreated={onCreated}
        />
      )}
      {modal?.type === 'invite' && (
        <InviteDialog inst={modal.inst} link={modal.link} onClose={() => setModal(null)} onCopied={() => setToast({ type: 'success', msg: 'Invite link copied' })} />
      )}
      {confirmRevoke && (
        <Modal title="Revoke access?" onClose={() => setConfirmRevoke(null)}>
          <p className="text-sm text-muted">
            This immediately blocks <span className="font-semibold text-ink">{confirmRevoke.name}</span>’s users from logging in
            (existing sessions end within a few minutes). Synced data is kept. You can reinstate later.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirmRevoke(null)} className="btn btn-soft">Cancel</button>
            <button onClick={() => revoke(confirmRevoke, true)} className="btn btn-danger">Revoke access</button>
          </div>
        </Modal>
      )}
      <Toast toast={toast} />
    </div>
  );
}

/* ---- Create / edit form ------------------------------------------------- */
function InstitutionForm({ inst, onClose, onSaved, onCreated }) {
  const editing = Boolean(inst);
  const [form, setForm] = useState(() => ({
    name: inst?.name || '',
    adminEmail: inst?.adminEmail || '',
    contractStart: inst?.contractStart ? String(inst.contractStart).slice(0, 10) : '',
    contractEnd: inst?.contractEnd ? String(inst.contractEnd).slice(0, 10) : '',
    lmsType: inst?.lmsType || 'canvas',
    studentSeats: inst?.studentSeats ?? 100,
    tier: inst?.tier || 'basic',
    featureFlags: inst?.featureFlags || TIER_DEFAULTS.basic,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setTier = (tier) => setForm((f) => ({ ...f, tier, featureFlags: { ...TIER_DEFAULTS[tier] } }));
  const toggleFeature = (key) => setForm((f) => ({ ...f, featureFlags: { ...f.featureFlags, [key]: !f.featureFlags[key] } }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Institution name is required.');
    if (!editing && !form.adminEmail.trim()) return setError('Admin email is required.');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        contractStart: form.contractStart || null,
        contractEnd: form.contractEnd || null,
        lmsType: form.lmsType || null,
        studentSeats: Number(form.studentSeats) || 0,
        tier: form.tier,
        featureFlags: form.featureFlags,
      };
      if (editing) {
        await institutionsApi.update(inst.id, payload);
        onSaved(`${form.name.trim()} updated`);
      } else {
        const res = await institutionsApi.create({ ...payload, adminEmail: form.adminEmail.trim().toLowerCase() });
        onCreated(res);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not save the institution.'));
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? 'Edit institution' : 'Create institution'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Institution name">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className="field" placeholder="Springfield University" />
          </Labeled>
          <Labeled label="Admin email">
            <input type="email" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} disabled={editing} className="field disabled:opacity-60" placeholder="it@school.edu" autoCapitalize="none" />
          </Labeled>
          <Labeled label="Contract start">
            <input type="date" value={form.contractStart} onChange={(e) => set('contractStart', e.target.value)} className="field" />
          </Labeled>
          <Labeled label="Contract end">
            <input type="date" value={form.contractEnd} onChange={(e) => set('contractEnd', e.target.value)} className="field" />
          </Labeled>
          <Labeled label="LMS type">
            <select value={form.lmsType} onChange={(e) => set('lmsType', e.target.value)} className="field">
              {LMS_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Labeled>
          <Labeled label="Student seats (soft cap)">
            <input type="number" min="0" value={form.studentSeats} onChange={(e) => set('studentSeats', e.target.value)} className="field" />
          </Labeled>
        </div>

        <Labeled label="Tier">
          <div className="flex gap-2">
            {['basic', 'pro'].map((t) => (
              <button key={t} type="button" onClick={() => setTier(t)} className={`rounded-xl px-3 py-1.5 text-sm font-semibold capitalize transition ${form.tier === t ? 'text-white shadow-sm' : 'bg-white/55 text-muted hover:bg-white/80'}`} style={form.tier === t ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}>
                {t}
              </button>
            ))}
            <span className="self-center text-xs text-muted">Basic = transcription + summaries · Pro = everything</span>
          </div>
        </Labeled>

        <Labeled label="Features">
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <label key={f.key} className="flex items-center justify-between rounded-xl border border-white/60 bg-white/40 px-3 py-1.5">
                <span className="text-sm text-ink">{f.label}</span>
                <Toggle on={!!form.featureFlags[f.key]} onChange={() => toggleFeature(f.key)} />
              </label>
            ))}
          </div>
        </Labeled>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}

/* ---- Invite-link dialog (shown after create) ---------------------------- */
function InviteDialog({ inst, link, onClose, onCopied }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); onCopied(); } catch { /* clipboard blocked */ }
  };
  return (
    <Modal title="Institution created" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">{inst.name}</span> is set up. Send this one-time link to
          <span className="font-semibold text-ink"> {inst.adminEmail}</span> so they can set their password and log in.
          It expires in 72 hours.
        </p>
        <div className="flex items-center gap-2">
          <input readOnly value={link} className="field font-mono text-xs" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={copy} className="btn btn-primary whitespace-nowrap">Copy link</button>
        </div>
        <p className="text-xs text-muted">No password is emailed or stored in plaintext — the link is the only way to activate the account.</p>
        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Done</button>
        </div>
      </div>
    </Modal>
  );
}
