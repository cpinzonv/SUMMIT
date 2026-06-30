import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, EmptyState } from './ui';
import { EmptyHero, NotepadIllustration } from './EmptyHero';
import { RichTextEditor } from './RichTextEditor';

/* ---- date helpers ------------------------------------------------------- */
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
function fullDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function previewText(content) {
  const t = (content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}
const isContentEmpty = (html) => !previewText(html);

const DotsIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
);
const ExpandIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>
);

export function ClassNotes({ classId }) {
  const [notes, setNotes] = useState([]);
  const [q, setQ] = useState('');
  const [view, setView] = useState('active'); // 'active' | 'archived'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { note, mode:'modal'|'full' }
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = useCallback(
    async (search = q, v = view) => {
      setError('');
      try {
        const { data } = await api.get(`/api/classes/${classId}/notes`, {
          params: { ...(search ? { q: search } : {}), ...(v === 'archived' ? { archived: 'true' } : {}) },
        });
        setNotes(data.notes);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [classId, q, view],
  );

  useEffect(() => {
    load(q, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, view]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => load(q, view), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setArchived = async (note, archived) => {
    try {
      await api.patch(`/api/notes/${note.id}`, { archived });
      await load(q, view);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const doDelete = async (note) => {
    try {
      await api.delete(`/api/notes/${note.id}`);
      setPendingDelete(null);
      if (editing?.note?.id === note.id) setEditing(null);
      await load(q, view);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Single click → modal; double click → full screen.
  const clickTimer = useRef(null);
  const openModal = (note) => {
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => setEditing({ note, mode: 'modal' }), 200);
  };
  const openFull = (note) => {
    clearTimeout(clickTimer.current);
    setEditing({ note, mode: 'full' });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" className="field max-w-xs" />
        <div className="flex gap-1 rounded-full bg-white/45 p-1 text-sm">
          {['active', 'archived'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 font-semibold capitalize transition ${view === v ? 'bg-white/85 text-brand-700 shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <button onClick={() => setEditing({ note: { isNew: true, title: '', content: '' }, mode: 'modal' })} className="btn btn-primary ml-auto">
          + New note
        </button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading notes…" />
      ) : notes.length === 0 ? (
        q || view === 'archived' ? (
          // Search / archived empty results keep the simple message.
          <EmptyState title={q ? 'No notes match your search' : 'No archived notes'} />
        ) : (
          // True empty state — the glassmorphism hero.
          <EmptyHero
            illustration={<NotepadIllustration />}
            headline="Start capturing ideas"
            subheading="Capture lecture notes, readings, and ideas. Notes auto-save as you type."
            ctaLabel="Create your first note"
            onCta={() => setEditing({ note: { isNew: true, title: '', content: '' }, mode: 'modal' })}
          />
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => openModal(note)}
              onDoubleClick={() => openFull(note)}
              className="note-surface group relative cursor-pointer p-5 transition hover:-translate-y-0.5"
            >
              <CardMenu
                archived={view === 'archived'}
                onArchive={() => setArchived(note, view !== 'archived')}
                onDelete={() => setPendingDelete(note)}
              />
              <h3 className="truncate pr-8 font-bold" style={{ color: 'var(--note-text)' }}>{note.title}</h3>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--note-accent)' }}>{shortDate(note.createdAt)}</p>
              <p className="mt-2 line-clamp-2 text-sm" style={{ color: 'rgba(45,55,72,0.7)' }}>
                {previewText(note.content) || 'Empty note'}
              </p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <NoteEditor
          classId={classId}
          note={editing.note}
          mode={editing.mode}
          onMode={(mode) => setEditing((e) => ({ ...e, mode }))}
          onClose={() => setEditing(null)}
          onChanged={() => load(q, view)}
          onArchive={(savedNote) => { setEditing(null); setArchived(savedNote, true); }}
          onRequestDelete={(savedNote) => setPendingDelete(savedNote)}
        />
      )}

      {pendingDelete && (
        <ConfirmDelete
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => doDelete(pendingDelete)}
        />
      )}
    </div>
  );
}

/* ---- 3-dot menu on a note card ----------------------------------------- */
function CardMenu({ archived, onArchive, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  const pick = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn(); };
  return (
    <div ref={ref} className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="Note options"
        className="grid h-7 w-7 place-items-center rounded-full text-muted opacity-0 transition hover:bg-black/5 hover:text-ink group-hover:opacity-100"
      >
        <DotsIcon className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="glass-panel absolute right-0 z-20 mt-1 w-40 overflow-hidden p-1.5 text-sm shadow-xl">
          <button type="button" onClick={pick(onArchive)} className="menu-item">
            <span>🗄</span> {archived ? 'Unarchive' : 'Archive'} note
          </button>
          <button type="button" onClick={pick(onDelete)} className="menu-item text-rose-600 hover:bg-rose-50/70">
            <span>🗑</span> Delete note
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- Auto-saving editor (modal or full-screen) ------------------------- */
function NoteEditor({ classId, note, mode, onMode, onClose, onChanged, onArchive, onRequestDelete }) {
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [status, setStatus] = useState('idle'); // idle | saving | saved
  const [menuOpen, setMenuOpen] = useState(false);
  const idRef = useRef(note.isNew ? null : note.id);
  const savedRef = useRef({ title: note.title || '', content: note.content || '' });
  const skipFirst = useRef(true);
  const fadeTimer = useRef(null);
  const menuRef = useRef(null);

  const persist = useCallback(async (t, c) => {
    if (t === savedRef.current.title && c === savedRef.current.content) return;
    if (!idRef.current && !t.trim() && isContentEmpty(c)) return; // don't create an empty note
    setStatus('saving');
    try {
      if (!idRef.current) {
        const { data } = await api.post(`/api/classes/${classId}/notes`, { title: t, content: c });
        idRef.current = data.note.id;
      } else {
        await api.patch(`/api/notes/${idRef.current}`, { title: t, content: c });
      }
      savedRef.current = { title: t, content: c };
      setStatus('saved');
      onChanged?.();
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1600);
    } catch {
      setStatus('error');
    }
  }, [classId, onChanged]);

  // Always hold the LATEST title/content/persist so the unmount flush below
  // saves what's actually on screen. (A stale mount-time closure here would
  // overwrite the note with its initial empty values when you navigate away.)
  const latestRef = useRef({ title, content, persist });
  latestRef.current = { title, content, persist };

  // Debounced auto-save on edits.
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return; }
    const h = setTimeout(() => persist(title, content), 800);
    return () => clearTimeout(h);
  }, [title, content, persist]);

  // Flush any pending save on unmount (e.g. navigating away via the router),
  // using the latest values — never the stale ones captured at mount.
  useEffect(() => () => {
    const { title: t, content: c, persist: p } = latestRef.current;
    p(t, c);
  }, []);

  const close = () => { persist(title, content); onClose(); };

  // Escape closes (modal) or exits full-screen → closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (menuOpen) setMenuOpen(false); else close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const savedNote = () => ({ ...note, id: idRef.current, title, content });
  const archived = Boolean(note.archivedAt);

  const TopBar = (
    <div className="flex items-center justify-end gap-1.5">
      <span className={`mr-auto text-xs transition-opacity ${status === 'idle' ? 'opacity-0' : 'opacity-100'}`} style={{ color: 'rgba(45,55,72,0.5)' }}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : status === 'error' ? 'Save failed' : ''}
      </span>
      <div ref={menuRef} className="relative">
        <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label="Note options" className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-black/5" style={{ color: 'var(--note-text)' }}>
          <DotsIcon className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div role="menu" className="glass-panel absolute right-0 z-20 mt-1 w-40 overflow-hidden p-1.5 text-sm shadow-xl">
            <button
              type="button"
              onClick={() => { setMenuOpen(false); if (idRef.current) onArchive(savedNote()); else onClose(); }}
              className="menu-item"
            >
              <span>🗄</span> {archived ? 'Unarchive' : 'Archive'} note
            </button>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); if (idRef.current) onRequestDelete(savedNote()); else onClose(); }}
              className="menu-item text-rose-600 hover:bg-rose-50/70"
            >
              <span>🗑</span> Delete note
            </button>
          </div>
        )}
      </div>
      <button type="button" onClick={() => onMode(mode === 'full' ? 'modal' : 'full')} aria-label={mode === 'full' ? 'Exit full screen' : 'Full screen'} title={mode === 'full' ? 'Exit full screen' : 'Full screen'} className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-black/5" style={{ color: 'var(--note-text)' }}>
        <ExpandIcon className="h-4 w-4" />
      </button>
      <button type="button" onClick={close} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-xl leading-none transition hover:bg-black/5" style={{ color: 'rgba(45,55,72,0.6)' }}>
        ×
      </button>
    </div>
  );

  const Body = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {TopBar}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled note"
        className="note-input text-lg font-bold"
        autoFocus
      />
      <div className="min-h-0 flex-1">
        <RichTextEditor value={content} onChange={setContent} fullHeight />
      </div>
    </div>
  );

  if (mode === 'full') {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col p-5 sm:p-8" style={{ background: 'var(--note-bg)' }}>
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">{Body}</div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm" onClick={close}>
      <div className="note-surface flex flex-col p-6" style={{ width: '85vw', maxWidth: 900, height: '80vh' }} onClick={(e) => e.stopPropagation()}>
        {Body}
      </div>
    </div>
  );
}

/* ---- Delete confirmation ----------------------------------------------- */
function ConfirmDelete({ onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="note-surface w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold" style={{ color: 'var(--note-text)' }}>Delete this note?</h3>
        <p className="mt-1 text-sm" style={{ color: 'rgba(45,55,72,0.65)' }}>This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-soft">Cancel</button>
          <button onClick={() => { setBusy(true); onConfirm(); }} disabled={busy} className="btn btn-danger">
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
