import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Modal, Toast, Spinner } from './ui';
import { dueStatus, countdownTone } from '../lib/dueDate';
import { assignmentsApi, STAGES, WIP_LIMIT, stageMeta, inFlightCount } from '../lib/assignments';

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/**
 * Kanban board for a class's assignments (Backlog · Active · In Progress · Done).
 * Native HTML5 drag-and-drop; the WIP limit (active + in-progress ≤ 3) is enforced
 * server-side and surfaced here. See docs/assignments-kanban.md.
 */
export default function AssignmentsBoard({ classId, assignments, onChanged }) {
  const [items, setItems] = useState(assignments);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => setItems(assignments), [assignments]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = (msg, type = 'success') => setToast({ type, msg });
  const inFlight = inFlightCount(items);

  const move = async (id, stage) => {
    const cur = items.find((a) => a.id === id);
    if (!cur || cur.stage === stage) return;
    const prev = items;
    setItems((list) => list.map((a) => (a.id === id ? { ...a, stage } : a))); // optimistic
    try {
      const updated = await assignmentsApi.setStage(id, stage);
      setItems((list) => list.map((a) => (a.id === id ? updated : a)));
      onChanged?.();
    } catch (e) {
      setItems(prev); // revert (e.g. WIP block)
      flash(errorMessage(e), 'error');
    }
  };

  const patchLocal = (updated) => {
    setItems((list) => list.map((a) => (a.id === updated.id ? updated : a)));
    onChanged?.();
  };
  const removeLocal = (id) => {
    setItems((list) => list.filter((a) => a.id !== id));
    setOpenId(null);
    onChanged?.();
  };

  const open = items.find((a) => a.id === openId) || null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted">Drag cards between columns. Max {WIP_LIMIT} in flight.</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${inFlight >= WIP_LIMIT ? 'bg-rose-100 text-rose-600' : 'bg-white/70 text-muted'}`}>
          {inFlight}/{WIP_LIMIT} in flight
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STAGES.map((s) => {
          const cards = items.filter((a) => a.stage === s.key);
          return (
            <div
              key={s.key}
              onDragOver={(e) => { e.preventDefault(); if (overCol !== s.key) setOverCol(s.key); }}
              onDragLeave={() => setOverCol((c) => (c === s.key ? null : c))}
              onDrop={(e) => { e.preventDefault(); const id = dragId || e.dataTransfer.getData('id'); setOverCol(null); move(id, s.key); }}
              className={`rounded-2xl border p-2.5 transition ${overCol === s.key ? 'border-brand-400 bg-white/60' : 'border-white/50 bg-white/25'}`}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} />
                  <span className="text-sm font-bold text-ink">{s.label}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.inFlight && inFlight >= WIP_LIMIT ? 'bg-rose-100 text-rose-600' : 'text-muted'}`}>{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((a) => (
                  <Card
                    key={a.id}
                    a={a}
                    dragging={dragId === a.id}
                    onOpen={() => setOpenId(a.id)}
                    onDragStart={(e) => { setDragId(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('id', a.id); }}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  />
                ))}
                {cards.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted/70">Drop here</p>}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <AssignmentDetail
          classId={classId}
          assignment={open}
          onClose={() => setOpenId(null)}
          onPatched={patchLocal}
          onRemoved={() => removeLocal(open.id)}
          onMove={(stage) => move(open.id, stage)}
          flash={flash}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

/* ---- Card -------------------------------------------------------------- */
const fmtDue = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Card({ a, dragging, onOpen, onDragStart, onDragEnd }) {
  const done = a.stage === 'done';
  const ds = dueStatus(a.dueDate);
  const overdue = ds.isPastDue && !done;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`glass-panel cursor-pointer rounded-xl p-3 transition hover:-translate-y-0.5 hover:shadow-md ${dragging ? 'opacity-40' : ''}`}
    >
      <p className="text-sm font-semibold text-ink">{a.title}</p>
      <div className="mt-1.5">
        {!a.dueDate ? (
          <span className="text-[11px] text-muted">No due date</span>
        ) : done ? (
          // Done: show the plain due date, never an overdue warning.
          <span className="text-[11px] text-muted">Due {fmtDue(a.dueDate)}</span>
        ) : overdue ? (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">{ds.lateLabel}</span>
        ) : (
          <span className={`text-[11px] font-semibold ${countdownTone(ds)}`}>{ds.countdownLabel}</span>
        )}
      </div>
    </div>
  );
}

/* ---- Detail modal ------------------------------------------------------ */
function AssignmentDetail({ classId, assignment: a, onClose, onPatched, onRemoved, onMove, flash }) {
  const [files, setFiles] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const ds = dueStatus(a.dueDate);

  useEffect(() => {
    assignmentsApi.listFiles(a.id).then(setFiles).catch(() => setFiles([]));
  }, [a.id]);

  const save = async (patch) => {
    try { onPatched(await assignmentsApi.update(a.id, patch)); } catch (e) { flash(errorMessage(e), 'error'); }
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      await assignmentsApi.uploadFile(classId, a.id, file);
      setFiles(await assignmentsApi.listFiles(a.id));
      flash('File attached');
    } catch (e) { flash(errorMessage(e), 'error'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const download = async (f) => {
    try {
      const res = await api.get(f.downloadUrl, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url; link.download = f.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { flash(errorMessage(e), 'error'); }
  };

  const removeFile = async (f) => {
    try { await assignmentsApi.removeFile(f.id); setFiles((list) => list.filter((x) => x.id !== f.id)); }
    catch (e) { flash(errorMessage(e), 'error'); }
  };

  const del = async () => {
    if (!confirm(`Delete "${a.title}"? This can't be undone.`)) return;
    try { await assignmentsApi.remove(a.id); onRemoved(); } catch (e) { flash(errorMessage(e), 'error'); }
  };

  return (
    <Modal title={a.title} onClose={onClose}>
      <div className="space-y-4">
        {/* meta */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${stageMeta(a.stage).tint}`}>{stageMeta(a.stage).label}</span>
          {a.category && <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs text-muted">{a.category}</span>}
          {a.dueDate && !ds.isPastDue && <span className={`text-xs font-semibold ${countdownTone(ds)}`}>{ds.countdownLabel}</span>}
          {ds.isPastDue && a.stage !== 'done' && <span className="text-xs font-bold text-rose-600">{ds.lateLabel}</span>}
        </div>

        {/* stage controls + complete toggle */}
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Move to</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s.key}
                onClick={() => onMove(s.key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${a.stage === s.key ? 'text-white shadow-sm' : 'bg-white/55 text-muted hover:bg-white/80'}`}
                style={a.stage === s.key ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
              >
                {s.label}
              </button>
            ))}
            {a.stage === 'done' ? (
              <button onClick={() => onMove('planning')} className="btn btn-soft !px-2.5 !py-1 text-xs">↩ Reopen</button>
            ) : (
              <button onClick={() => onMove('done')} className="btn btn-soft !px-2.5 !py-1 text-xs">✓ Mark complete</button>
            )}
          </div>
        </div>

        {/* academic status (feeds grades) */}
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Status</span>
          <select value={a.status} onChange={(e) => save({ status: e.target.value })} className="field !w-56">
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="submitted">Submitted</option>
            <option value="graded">Graded</option>
          </select>
        </label>

        {/* due date */}
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Due date</span>
          <input
            type="date"
            defaultValue={toDateInput(a.dueDate)}
            onChange={(e) => save({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className="field !w-48"
          />
        </label>

        {/* instructions */}
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Instructions</span>
          <textarea
            defaultValue={a.description || ''}
            key={`desc-${a.id}`}
            onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (a.description || null)) save({ description: v }); }}
            rows={3}
            placeholder="Assignment instructions / notes…"
            className="field w-full resize-y text-sm"
          />
        </label>

        {/* submission */}
        <div>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Your submission</span>
          <textarea
            defaultValue={a.submissionText || ''}
            key={`sub-${a.id}`}
            onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (a.submissionText || null)) save({ submissionText: v }); }}
            rows={3}
            placeholder="Type your submission, notes, or a link…"
            className="field w-full resize-y text-sm"
          />
          <div className="mt-2 space-y-1.5">
            {files === null ? (
              <Spinner label="Loading files…" />
            ) : (
              files.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-lg bg-white/50 px-3 py-1.5 text-sm">
                  <button onClick={() => download(f)} className="min-w-0 flex-1 truncate text-left font-medium text-brand-600 hover:underline" title="Download">📎 {f.filename}</button>
                  <span className="shrink-0 text-[11px] text-muted">{Math.max(1, Math.round(f.sizeBytes / 1024))} KB</span>
                  <button onClick={() => removeFile(f)} aria-label="Remove file" className="shrink-0 text-muted transition hover:text-rose-500">×</button>
                </div>
              ))
            )}
          </div>
          <div className="mt-2">
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-soft text-sm">
              {uploading ? 'Uploading…' : '＋ Attach file'}
            </button>
          </div>
        </div>

        <div className="flex justify-between border-t border-white/40 pt-3">
          <button onClick={del} className="text-sm font-semibold text-rose-500 hover:underline">Delete assignment</button>
          <button onClick={onClose} className="btn btn-primary">Done</button>
        </div>
      </div>
    </Modal>
  );
}
