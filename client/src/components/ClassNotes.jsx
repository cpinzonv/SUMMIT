import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, EmptyState } from './ui';
import { MarkdownEditor } from './MarkdownEditor';

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
  return new Date(iso).toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
// Plain-text preview (strip the most common Markdown markers).
function previewText(content) {
  const t = (content || '')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}

export function ClassNotes({ classId }) {
  const [notes, setNotes] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // note object, or { isNew: true }
  const [fullScreen, setFullScreen] = useState(false);

  const load = useCallback(
    async (search = q) => {
      setError('');
      try {
        const { data } = await api.get(`/api/classes/${classId}/notes`, {
          params: search ? { q: search } : {},
        });
        setNotes(data.notes);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [classId, q],
  );

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const removeNote = async (note) => {
    if (!confirm(`Delete "${note.title}"?`)) return;
    try {
      await api.delete(`/api/notes/${note.id}`);
      await load(q);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notes…"
          className="field max-w-xs"
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFullScreen(true)}
            title="Open in full screen"
            aria-label="Open notes in full screen"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/60 bg-white/55 text-muted transition hover:bg-white/85 hover:text-ink"
          >
            ⛶
          </button>
          <button onClick={() => setEditing({ isNew: true, title: '', content: '' })} className="btn btn-primary">
            + New note
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading notes…" />
      ) : notes.length === 0 ? (
        <EmptyState title={q ? 'No notes match your search' : 'No notes yet'}>
          {!q && 'Capture lecture notes, readings, and ideas — formatted with Markdown.'}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="note-surface group flex flex-col p-5 transition hover:-translate-y-0.5"
            >
              <button onClick={() => setEditing(note)} className="min-w-0 flex-1 text-left">
                <h3 className="truncate font-bold" style={{ color: 'var(--note-text)' }}>{note.title}</h3>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--note-accent)' }}>
                  {shortDate(note.createdAt)}
                </p>
                <p className="mt-2 line-clamp-2 text-sm" style={{ color: 'rgba(45,55,72,0.7)' }}>
                  {previewText(note.content) || 'Empty note'}
                </p>
              </button>
              <div className="mt-3 flex items-center justify-end gap-3 text-xs font-semibold">
                <button onClick={() => setEditing(note)} className="text-muted transition hover:text-[color:var(--note-accent)]">
                  Edit
                </button>
                <button onClick={() => removeNote(note)} className="text-muted transition hover:text-rose-500">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <NoteModal
          classId={classId}
          note={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load(q);
          }}
          onDeleted={async () => {
            setEditing(null);
            await load(q);
          }}
        />
      )}

      {fullScreen && (
        <NotesFullScreen
          classId={classId}
          onClose={() => {
            setFullScreen(false);
            load(q);
          }}
        />
      )}
    </div>
  );
}

/* ---- Shared editor body (title + dates + markdown + actions) ------------ */
function NoteEditorBody({ classId, note, fullHeight, onSaved, onClose, onDeleted }) {
  const isNew = note.isNew;
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (e) => {
    e?.preventDefault?.();
    setSaving(true);
    setError('');
    try {
      const { data } = isNew
        ? await api.post(`/api/classes/${classId}/notes`, { title, content })
        : await api.patch(`/api/notes/${note.id}`, { title, content });
      await onSaved(data.note);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this note?')) return;
    try {
      await api.delete(`/api/notes/${note.id}`);
      await onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={save} className={`flex flex-col gap-3 ${fullHeight ? 'h-full' : ''}`}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title"
        className="note-input text-lg font-bold"
        autoFocus
      />

      {!isNew && (note.createdAt || note.updatedAt) && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: 'rgba(45,55,72,0.55)' }}>
          {note.createdAt && <span>Created: {fullDateTime(note.createdAt)}</span>}
          {note.updatedAt && <span>Modified: {fullDateTime(note.updatedAt)}</span>}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className={fullHeight ? 'min-h-0 flex-1' : ''}>
        <MarkdownEditor value={content} onChange={setContent} placeholder="Write your note in Markdown…" fullHeight={fullHeight} />
      </div>

      <div className="flex items-center gap-2">
        {!isNew && (
          <button type="button" onClick={remove} className="note-tool mr-auto text-rose-500 hover:!bg-rose-50 hover:!text-rose-600">
            Delete
          </button>
        )}
        <button type="button" onClick={onClose} className={`btn btn-soft ${isNew ? 'ml-auto' : ''}`}>
          {fullHeight ? 'Cancel' : 'Close'}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="btn"
          style={{ backgroundColor: 'var(--note-accent)', color: '#fff' }}
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </form>
  );
}

/* ---- Centered modal editor (warm white, ~85vw × 80vh) ------------------- */
function NoteModal({ classId, note, onClose, onSaved, onDeleted }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="note-surface flex max-h-[85vh] w-full max-w-[900px] flex-col p-6"
        style={{ width: '85vw', height: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold" style={{ color: 'var(--note-text)' }}>
            {note.isNew ? 'New note' : 'Edit note'}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none" style={{ color: 'rgba(45,55,72,0.5)' }}>
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <NoteEditorBody
            classId={classId}
            note={note}
            fullHeight
            onClose={onClose}
            onSaved={onSaved}
            onDeleted={onDeleted}
          />
        </div>
      </div>
    </div>
  );
}

/* ---- Full-screen note workspace (sidebar + editor) ---------------------- */
function NotesFullScreen({ classId, onClose }) {
  const [notes, setNotes] = useState([]);
  const [selected, setSelected] = useState(null); // note | { isNew:true } | null
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data } = await api.get(`/api/classes/${classId}/notes`);
    setNotes(data.notes);
    setLoading(false);
    return data.notes;
  }, [classId]);

  useEffect(() => {
    reload().then((list) => setSelected((s) => s || list[0] || { isNew: true, title: '', content: '' }));
  }, [reload]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'var(--note-bg)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--note-border)' }}>
        <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--note-text)' }}>
          <span style={{ color: 'var(--note-accent)' }}>✎</span> Notes
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close full screen"
          className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-black/5"
          style={{ color: 'var(--note-text)' }}
        >
          ×
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r sm:flex" style={{ borderColor: 'var(--note-border)' }}>
          <div className="p-3">
            <button
              onClick={() => setSelected({ isNew: true, title: '', content: '' })}
              className="w-full rounded-lg py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--note-accent)' }}
            >
              + New note
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {loading ? (
              <p className="px-2 text-sm" style={{ color: 'rgba(45,55,72,0.5)' }}>Loading…</p>
            ) : (
              notes.map((n) => {
                const active = !selected?.isNew && selected?.id === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => setSelected(n)}
                    className="mb-1 w-full rounded-lg px-3 py-2 text-left transition"
                    style={active ? { background: 'rgba(32,178,170,0.14)' } : undefined}
                  >
                    <div className="truncate text-sm font-semibold" style={{ color: 'var(--note-text)' }}>{n.title}</div>
                    <div className="text-[11px]" style={{ color: 'rgba(45,55,72,0.5)' }}>{shortDate(n.createdAt)}</div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Editor */}
        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
          <div className="mx-auto h-full max-w-3xl">
            {selected ? (
              <NoteEditorBody
                key={selected.id || 'new'}
                classId={classId}
                note={selected}
                fullHeight
                onClose={onClose}
                onSaved={async (saved) => {
                  const list = await reload();
                  setSelected(list.find((n) => n.id === saved.id) || saved);
                }}
                onDeleted={async () => {
                  const list = await reload();
                  setSelected(list[0] || { isNew: true, title: '', content: '' });
                }}
              />
            ) : (
              <p style={{ color: 'rgba(45,55,72,0.5)' }}>Select a note or create a new one.</p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
