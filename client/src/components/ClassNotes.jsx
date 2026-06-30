import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, EmptyState, Modal } from './ui';
import { MarkdownEditor } from './MarkdownEditor';
import { renderMarkdown } from '../utils/markdown';

export function ClassNotes({ classId }) {
  const [notes, setNotes] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // note object, or { isNew: true }

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

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notes…"
          className="field max-w-xs"
        />
        <button onClick={() => setEditing({ isNew: true, title: '', content: '' })} className="btn btn-primary ml-auto">
          + New note
        </button>
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
            <button
              key={note.id}
              onClick={() => setEditing(note)}
              className="glass-card p-5 text-left transition hover:-translate-y-0.5"
            >
              <h3 className="font-bold text-ink">{note.title}</h3>
              <div
                className="note-prose mt-2 line-clamp-4 text-sm opacity-80"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content.slice(0, 280)) }}
              />
              <p className="mt-3 text-xs text-muted">
                Updated {new Date(note.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <NoteEditorModal
          classId={classId}
          note={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load(q);
          }}
        />
      )}
    </div>
  );
}

function NoteEditorModal({ classId, note, onClose, onSaved }) {
  const isNew = note.isNew;
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        await api.post(`/api/classes/${classId}/notes`, { title, content });
      } else {
        await api.patch(`/api/notes/${note.id}`, { title, content });
      }
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this note?')) return;
    try {
      await api.delete(`/api/notes/${note.id}`);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal title={isNew ? 'New note' : 'Edit note'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        <ErrorBanner message={error} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title"
          className="field font-semibold"
        />
        <MarkdownEditor value={content} onChange={setContent} placeholder="Write your note in Markdown…" />
        <div className="flex items-center gap-2 pt-1">
          {!isNew && (
            <button type="button" onClick={remove} className="btn btn-soft mr-auto !text-rose-500">
              Delete
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-soft ml-auto">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
