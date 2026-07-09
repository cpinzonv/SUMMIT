import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Modal, ErrorBanner, ConfirmModal } from './ui';
import { RichTextEditor } from './RichTextEditor';
import { dueStatus, isDone } from '../lib/dueDate';
import { sanitizeHtml } from '../utils/sanitize';

/* ------------------------------------------------------------------ helpers */

/** "1 h 30 m" from decimal hours; null-safe. */
export function estimateLabel(estimatedHours) {
  if (estimatedHours == null) return null;
  const mins = Math.round(Number(estimatedHours) * 60);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} h ${m} m`;
  if (h) return `${h} h`;
  return `${m} m`;
}

const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const dateInputToISO = (v) => (v ? new Date(`${v}T00:00:00`).toISOString() : null);

/** Debounce a callback (stable across renders). */
function useDebouncedSave(fn, delay = 800) {
  const timer = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]);
}

const TABS = [
  { key: 'instructions', label: 'Instructions' },
  { key: 'files', label: 'File Upload' },
  { key: 'working', label: 'Working' },
  { key: 'submission', label: 'Submission' },
];

// Board stage ↔ the three status pills.
const STATUS_PILLS = [
  { stage: 'planning', label: 'Planning', on: 'bg-sky-500' },
  { stage: 'in_progress', label: 'In Progress', on: 'bg-amber-500' },
  { stage: 'done', label: 'Done', on: 'bg-emerald-500' },
];
const pillFor = (stage) => (stage === 'done' ? 'done' : stage === 'in_progress' ? 'in_progress' : 'planning');

/* -------------------------------------------------------------- main modal */

export function AssignmentDetailModal({ assignment, onClose, onChanged }) {
  const [a, setA] = useState(assignment);
  const [tab, setTab] = useState('instructions');
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(assignment.instructions !== undefined);

  // Callers may pass only a partial card (To-Do board, Dashboard). Fetch the full
  // assignment once on open so every tab has instructions/working/etc. The tab
  // editors mount off `hydrated` so they initialize with the loaded content.
  useEffect(() => {
    let active = true;
    api.get(`/api/assignments/${assignment.id}`)
      .then(({ data }) => { if (active) { setA(data.assignment); setHydrated(true); } })
      .catch((err) => { if (active) setError(errorMessage(err)); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id]);

  // Push a partial change to the server, update local state, and refresh parent.
  const patch = useCallback(async (payload) => {
    try {
      const { data } = await api.patch(`/api/assignments/${a.id}`, payload);
      setA(data.assignment);
      onChanged?.();
      return data.assignment;
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [a.id, onChanged]);

  const setStage = async (stage) => {
    const prev = a.boardStage;
    setA((x) => ({ ...x, boardStage: stage })); // optimistic
    try {
      await api.patch(`/api/todo/assignment/${a.id}/stage`, { stage });
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
      setA((x) => ({ ...x, boardStage: prev }));
    }
  };

  const st = dueStatus(a.dueDate);
  const overdue = st.isPastDue && !isDone(a);
  const estLabel = estimateLabel(a.estimatedHours);
  const active = pillFor(a.boardStage);

  return (
    <Modal title="" onClose={onClose} wide>
      {/* Header */}
      <div className="-mt-3">
        <input
          value={a.title}
          onChange={(e) => setA((x) => ({ ...x, title: e.target.value }))}
          onBlur={(e) => e.target.value.trim() && e.target.value !== assignment.title && patch({ title: e.target.value.trim() })}
          className="w-full bg-transparent text-xl font-bold text-ink focus:outline-none"
          placeholder="Assignment title"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {STATUS_PILLS.map((p) => (
            <button
              key={p.stage}
              type="button"
              onClick={() => setStage(p.stage)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                active === p.stage ? `${p.on} text-white shadow-sm` : 'bg-white/60 text-muted hover:bg-white/85'
              }`}
            >
              {p.label}
            </button>
          ))}
          {estLabel && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">
              ⏱ Est. {estLabel}
            </span>
          )}
        </div>

        {/* Compact meta row — autosaves on change. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetaField label="Due date" type="date" value={toDateInput(a.dueDate)}
            onCommit={(v) => patch({ dueDate: v ? dateInputToISO(v) : null })} />
          <MetaField label="Points" type="number" value={a.pointValue ?? ''}
            onCommit={(v) => patch({ pointValue: v === '' ? null : Number(v) })} />
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-semibold text-muted">Priority</span>
            <select value={a.priority || 'none'} onChange={(e) => patch({ priority: e.target.value })} className="field !py-1.5 text-sm">
              <option value="none">None</option><option value="low">Low</option>
              <option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
          <MetaField label="Category" value={a.category ?? ''} placeholder="Homework…"
            onCommit={(v) => patch({ category: v || null })} />
        </div>

        {st.hasDue && (
          <p className={`mt-2 text-xs font-semibold ${overdue ? 'text-rose-600' : 'text-muted'}`}>
            {overdue ? st.lateLabel : isDone(a) ? '✓ Done' : st.countdownLabel}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-white/50">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
              tab === t.key ? 'border-brand-500 text-brand-700' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      <div className="mt-4">
        {!hydrated ? (
          <p className="py-8 text-center text-sm text-muted">Loading…</p>
        ) : (
          <>
            {tab === 'instructions' && <InstructionsTab a={a} patch={patch} onEstimated={(hours) => setA((x) => ({ ...x, estimatedHours: hours }))} />}
            {tab === 'files' && <FilesTab a={a} />}
            {tab === 'working' && <WorkingTab a={a} patch={patch} />}
            {tab === 'submission' && <SubmissionTab a={a} onChanged={onChanged} />}
          </>
        )}
      </div>
    </Modal>
  );
}

function MetaField({ label, value, onCommit, type = 'text', placeholder }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-semibold text-muted">{label}</span>
      <input
        type={type}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => String(v) !== String(value) && onCommit(v)}
        className="field !py-1.5 text-sm"
      />
    </label>
  );
}

/* ------------------------------------------------------- Instructions tab */

function InstructionsTab({ a, patch, onEstimated }) {
  const [html, setHtml] = useState(a.instructions || '');
  const [estimating, setEstimating] = useState(false);
  const [estError, setEstError] = useState('');
  const saveDebounced = useDebouncedSave((v) => patch({ instructions: v }));

  const onChange = (v) => { setHtml(v); saveDebounced(v); };

  const estimate = useCallback(async () => {
    setEstimating(true); setEstError('');
    try {
      const { data } = await api.post(`/api/assignments/${a.id}/estimate-time`, { instructions: html });
      onEstimated(data.estimatedHours);
    } catch (err) {
      setEstError(errorMessage(err, 'Could not estimate the time.'));
    } finally { setEstimating(false); }
  }, [a.id, html, onEstimated]);

  // Estimate automatically shortly after a paste (once content has settled).
  const onPaste = () => { setTimeout(() => { if (!estimating) estimate(); }, 600); };

  const label = estimateLabel(a.estimatedHours);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Paste or write the assignment instructions. We'll estimate how long it takes.</p>
        <button type="button" onClick={estimate} disabled={estimating} className="btn btn-soft text-sm">
          {estimating ? 'Estimating…' : '⏱ Estimate time'}
        </button>
      </div>

      {(label || estimating) && (
        <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700">
          {estimating ? 'Estimating time…' : `Estimated time: ${label} (for an average person)`}
        </p>
      )}
      {estError && <p className="text-sm font-semibold text-rose-600">{estError}</p>}

      <div onPaste={onPaste} className="rounded-xl">
        <RichTextEditor key={`instr-${a.id}`} value={html} onChange={onChange} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- File Upload tab */

function FilesTab({ a }) {
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { url, type, name }
  const [renaming, setRenaming] = useState(null); // fileId
  const [confirm, setConfirm] = useState(null); // file pending delete
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/assignments/${a.id}/files`);
      setFiles(data.files);
    } catch (err) { setError(errorMessage(err)); }
  }, [a.id]);
  useEffect(() => { load(); }, [load]);
  // Revoke any object URL when the preview changes/unmounts.
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/api/assignments/${a.id}/files`, fd);
      await load();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const view = async (f) => {
    setError('');
    try {
      const res = await api.get(`/api/files/${f.id}/download`, { responseType: 'blob' });
      const type = (f.mimeType || res.data.type || '').toLowerCase();
      const isDocx = type.includes('wordprocessingml') || /\.docx$/i.test(f.filename);
      if (isDocx) {
        // Convert .docx → HTML in-browser (mammoth, no network) and show inline.
        const buf = await res.data.arrayBuffer();
        const { convertToHtml } = await import('mammoth');
        const { value } = await convertToHtml({ arrayBuffer: buf });
        setPreview({ html: value || '<p class="text-muted">This document has no readable text.</p>', type: 'docx', name: f.filename });
        return;
      }
      const url = URL.createObjectURL(res.data);
      if (type.includes('pdf') || type.startsWith('image/')) {
        setPreview({ url, type, name: f.filename });
      } else {
        window.open(url, '_blank', 'noopener'); // download/open other types
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (err) { setError(errorMessage(err, 'Could not open that file.')); }
  };

  const rename = async (f, filename) => {
    if (!filename.trim() || filename === f.filename) { setRenaming(null); return; }
    try {
      await api.patch(`/api/assignments/${a.id}/files/${f.id}`, { filename: filename.trim() });
      setRenaming(null);
      await load();
    } catch (err) { setError(errorMessage(err)); }
  };

  const remove = async (f) => {
    try {
      await api.delete(`/api/assignments/${a.id}/files/${f.id}`);
      if (preview?.name === f.filename) setPreview(null);
      setConfirm(null);
      await load();
    } catch (err) { setError(errorMessage(err)); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Upload the assignment instructions as files (PDF, DOCX, images…).</p>
        <label className="btn btn-primary cursor-pointer text-sm">
          {busy ? 'Uploading…' : '⬆ Upload file'}
          <input ref={inputRef} type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}

      {files == null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="rounded-xl bg-white/40 px-4 py-6 text-center text-sm text-muted">No files yet.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/55 px-3 py-2">
              <span>📄</span>
              {renaming === f.id ? (
                <input
                  autoFocus
                  defaultValue={f.filename}
                  onBlur={(e) => rename(f, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') rename(f, e.target.value); if (e.key === 'Escape') setRenaming(null); }}
                  className="field !py-1 flex-1 text-sm"
                />
              ) : (
                <button type="button" onClick={() => view(f)} className="flex-1 truncate text-left text-sm font-semibold text-brand-600 hover:underline">
                  {f.filename}
                </button>
              )}
              <span className="text-xs text-muted">{Math.max(1, Math.round(f.sizeBytes / 1024))} KB</span>
              <button type="button" onClick={() => setRenaming(f.id)} className="text-xs font-semibold text-muted hover:text-ink">Rename</button>
              <button type="button" onClick={() => setConfirm(f)} className="text-xs font-semibold text-rose-500 hover:text-rose-700">Delete</button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="rounded-xl border border-white/60 bg-white/70 p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-ink">{preview.name}</span>
            <button type="button" onClick={() => setPreview(null)} className="text-xs font-semibold text-muted hover:text-ink">Close preview</button>
          </div>
          {preview.type === 'docx' ? (
            <div
              className="note-prose max-h-[55vh] overflow-y-auto rounded-lg bg-white p-4"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.html) }}
            />
          ) : preview.type.startsWith('image/') ? (
            <img src={preview.url} alt={preview.name} className="mx-auto max-h-[50vh] rounded-lg" />
          ) : (
            <iframe title={preview.name} src={preview.url} className="h-[55vh] w-full rounded-lg" />
          )}
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title="Delete file?"
          message={`Delete "${confirm.filename}"? This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => remove(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Working tab */

function WorkingTab({ a, patch }) {
  const [saved, setSaved] = useState(true);
  const saveDebounced = useDebouncedSave(async (v) => { await patch({ workingContent: v }); setSaved(true); });

  const onChange = (v) => { setSaved(false); saveDebounced(v); };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Your in-app workspace — rich text, math (LaTeX), and handwriting. Auto-saves.</p>
        <span className={`text-xs font-semibold ${saved ? 'text-emerald-600' : 'text-muted'}`}>{saved ? '✓ Saved' : 'Saving…'}</span>
      </div>
      <RichTextEditor key={`working-${a.id}`} value={a.workingContent || ''} onChange={onChange} fullHeight />
    </div>
  );
}

/* ----------------------------------------------------------- Submission tab */

function SubmissionTab({ a, onChanged }) {
  const [subs, setSubs] = useState(null);
  const [mode, setMode] = useState('file'); // file | link | working
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/assignments/${a.id}/submissions`);
      setSubs(data.submissions);
    } catch (err) { setError(errorMessage(err)); }
  }, [a.id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('kind', mode);
      if (mode === 'file') { if (!file) throw new Error('Choose a file first.'); fd.append('file', file); }
      if (mode === 'link') fd.append('url', url.trim());
      if (mode === 'working') fd.append('text', a.workingContent || '');
      await api.post(`/api/assignments/${a.id}/submissions`, fd);
      setUrl(''); setFile(null); if (fileRef.current) fileRef.current.value = '';
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message && !err.response ? err.message : errorMessage(err));
    } finally { setBusy(false); }
  };

  const remove = async (s) => {
    try {
      await api.delete(`/api/assignments/${a.id}/submissions/${s.id}`);
      setConfirm(null);
      await load();
      onChanged?.();
    } catch (err) { setError(errorMessage(err)); }
  };

  const viewFile = async (s) => {
    try {
      const res = await api.get(`/api/files/${s.file.id}/download`, { responseType: 'blob' });
      const u = URL.createObjectURL(res.data);
      window.open(u, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (err) { setError(errorMessage(err)); }
  };

  const MODES = [
    { key: 'file', label: 'Upload file' },
    { key: 'link', label: 'Google Doc link' },
    { key: 'working', label: 'Submit my Working' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === m.key ? 'bg-brand-600 text-white shadow-sm' : 'bg-white/60 text-muted hover:bg-white/85'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'file' && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <span className="rounded-lg border border-white/60 bg-white/55 px-3 py-1.5 font-semibold text-ink hover:bg-white/80">📎 Choose file</span>
            <span className="truncate">{file ? file.name : 'No file chosen'}</span>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        {mode === 'link' && (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/…"
            className="field text-sm"
          />
        )}
        {mode === 'working' && (
          <p className="text-sm text-muted">Submit a snapshot of whatever is currently in your Working tab.</p>
        )}

        {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={submit} disabled={busy || (mode === 'file' && !file) || (mode === 'link' && !url.trim())} className="btn btn-primary text-sm">
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>

      <div className="border-t border-white/50 pt-3">
        <h4 className="mb-2 text-sm font-bold text-ink">Submission history</h4>
        {subs == null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : subs.length === 0 ? (
          <p className="rounded-xl bg-white/40 px-4 py-5 text-center text-sm text-muted">No submissions yet.</p>
        ) : (
          <ul className="space-y-2">
            {subs.map((s, i) => (
              <li
                key={s.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                  i === 0 ? 'border-emerald-300 bg-emerald-50/70' : 'border-white/60 bg-white/55'
                }`}
              >
                <span>{s.kind === 'link' ? '🔗' : s.kind === 'file' ? '📎' : '📝'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {s.kind === 'link' ? 'Link' : s.kind === 'file' ? 'File' : 'Working snapshot'}
                    </span>
                    {i === 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Latest</span>}
                  </div>
                  {s.kind === 'link' && <a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-brand-600 hover:underline">{s.url}</a>}
                  {s.kind === 'file' && <button type="button" onClick={() => viewFile(s)} className="block truncate text-xs font-semibold text-brand-600 hover:underline">{s.file?.filename}</button>}
                  <span className="text-[11px] text-muted">{new Date(s.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <button type="button" onClick={() => setConfirm(s)} className="text-xs font-semibold text-rose-500 hover:text-rose-700">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title="Delete submission?"
          message="Remove this submission from the history? This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => remove(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
