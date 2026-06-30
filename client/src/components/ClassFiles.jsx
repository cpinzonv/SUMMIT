import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, EmptyState, Modal } from './ui';

// Document categories shown in the Files tab (audio is internal to recordings).
const DOC_CATEGORIES = [
  { key: 'pdf', label: 'PDFs', icon: '📄', hint: 'Syllabus, handouts, notes' },
  { key: 'slides', label: 'Slides', icon: '🎬', hint: 'Lecture presentations' },
  { key: 'textbook', label: 'Textbooks', icon: '📚', hint: 'eBooks, textbook PDFs' },
  { key: 'formula_sheet', label: 'Formula Sheets', icon: '📋', hint: 'Quick reference' },
];
const DOC_KEYS = DOC_CATEGORIES.map((c) => c.key);

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDay(d) {
  if (!d) return null;
  return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function fmtDuration(s) {
  if (s == null) return null;
  const sec = s % 60;
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * Per-class Files tab: documents grouped into categories (PDFs, Slides,
 * Textbooks, Formula Sheets) each with its own upload, plus a Transcripts
 * section supporting in-app recording (MediaRecorder) and pasted/uploaded text.
 */
export function ClassFiles({ classId }) {
  const [files, setFiles] = useState(null);
  const [transcripts, setTranscripts] = useState(null);
  const [error, setError] = useState('');
  const [uploadingCat, setUploadingCat] = useState(null);
  const [modal, setModal] = useState(null); // {type:'uploadTranscript'} | {type:'viewTranscript',transcript}
  const [search, setSearch] = useState('');

  const pendingCat = useRef('pdf');
  const fileInput = useRef(null);

  const loadFiles = () =>
    api.get(`/api/classes/${classId}/files`).then((r) => setFiles(r.data.files)).catch((e) => setError(errorMessage(e)));
  const loadTranscripts = () =>
    api.get(`/api/classes/${classId}/transcripts`).then((r) => setTranscripts(r.data.transcripts)).catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    loadFiles();
    loadTranscripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  /* ---- File uploads (per category) ------------------------------------- */
  const pickFor = (category) => {
    pendingCat.current = category;
    fileInput.current?.click();
  };
  const onFilePicked = async (e) => {
    const list = e.target.files;
    if (!list?.length) return;
    const category = pendingCat.current;
    setError('');
    setUploadingCat(category);
    try {
      for (const file of Array.from(list)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', category);
        await api.post(`/api/classes/${classId}/files`, fd);
      }
      await loadFiles();
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'));
    } finally {
      setUploadingCat(null);
      e.target.value = '';
    }
  };

  const openFile = async (f) => {
    try {
      const res = await api.get(`/api/files/${f.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(errorMessage(err, 'Could not open file'));
    }
  };
  const deleteFile = async (f) => {
    if (!confirm(`Delete "${f.filename}"?`)) return;
    try {
      await api.delete(`/api/files/${f.id}`);
      setFiles((fs) => fs.filter((x) => x.id !== f.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete file'));
    }
  };

  const deleteTranscript = async (tr) => {
    if (!confirm(`Delete "${tr.title}"?`)) return;
    try {
      await api.delete(`/api/transcripts/${tr.id}`);
      setTranscripts((ts) => ts.filter((x) => x.id !== tr.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete transcript'));
    }
  };

  const filtered = (transcripts || []).filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (t.title || '').toLowerCase().includes(q) || (t.content || '').toLowerCase().includes(q);
  });

  // Any files in categories we don't surface as their own section (e.g. legacy).
  const otherFiles = (files || []).filter((f) => f.category !== 'audio' && !DOC_KEYS.includes(f.category));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-rose-300/50 bg-rose-50/70 px-4 py-2.5 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      <input ref={fileInput} type="file" multiple className="hidden" onChange={onFilePicked} />

      {files === null ? (
        <Spinner label="Loading files…" />
      ) : (
        DOC_CATEGORIES.map((cat) => {
          const group = files.filter((f) => f.category === cat.key);
          return (
            <FileCategory
              key={cat.key}
              cat={cat}
              files={group}
              uploading={uploadingCat === cat.key}
              onUpload={() => pickFor(cat.key)}
              onOpen={openFile}
              onDelete={deleteFile}
            />
          );
        })
      )}

      {otherFiles.length > 0 && (
        <FileCategory
          cat={{ key: 'other', label: 'Other files', icon: '🗂️', hint: '' }}
          files={otherFiles}
          uploading={uploadingCat === 'other'}
          onUpload={() => pickFor('other')}
          onOpen={openFile}
          onDelete={deleteFile}
        />
      )}

      {/* ---- Transcripts -------------------------------------------------- */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <span className="text-base">🎙️</span> Transcripts
            {transcripts ? ` (${transcripts.length})` : ''}
          </h3>
          <div className="flex gap-2">
            <RecordButton classId={classId} onSaved={loadTranscripts} onView={(tr) => setModal({ type: 'viewTranscript', transcript: tr })} onError={setError} />
            <button onClick={() => setModal({ type: 'uploadTranscript' })} className="btn btn-soft !py-1.5 text-sm">
              Upload transcript
            </button>
          </div>
        </div>

        {transcripts === null ? (
          <Spinner label="Loading transcripts…" />
        ) : transcripts.length === 0 ? (
          <EmptyState title="No transcripts yet">
            Record a lecture or upload a transcript to keep it searchable with this class.
          </EmptyState>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transcripts…"
              className="field mb-2"
            />
            <div className="glass-card divide-y divide-white/40 overflow-hidden">
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">No transcripts match “{search}”.</p>
              ) : (
                filtered.map((tr) => (
                  <div key={tr.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-lg">🎙️</span>
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'viewTranscript', transcript: tr })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-semibold text-ink hover:text-brand-600">
                        {tr.title}
                        {!tr.content && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                            Needs text
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted">
                        {[fmtDay(tr.recordedDate) || fmtDate(tr.createdAt), fmtDuration(tr.durationSeconds), SOURCE_LABEL[tr.source]]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </button>
                    {tr.audioFileId && (
                      <button
                        type="button"
                        onClick={() => openFile({ id: tr.audioFileId, filename: 'recording' })}
                        className="text-xs font-semibold text-brand-600 transition hover:underline"
                        title="Play / download audio"
                      >
                        ▶ Audio
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteTranscript(tr)}
                      className="text-xs font-semibold text-muted transition hover:text-rose-500"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {modal?.type === 'uploadTranscript' && (
        <UploadTranscriptModal
          classId={classId}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadTranscripts();
          }}
        />
      )}
      {modal?.type === 'viewTranscript' && (
        <TranscriptModal
          transcript={modal.transcript}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadTranscripts();
          }}
        />
      )}
    </div>
  );
}

const SOURCE_LABEL = { recording: '🎙 Recording', paste: 'Pasted', upload: 'Uploaded' };

/* ---- A single document category section -------------------------------- */
function FileCategory({ cat, files, uploading, onUpload, onOpen, onDelete }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
          <span className="text-base">{cat.icon}</span> {cat.label} ({files.length})
        </h3>
        <button onClick={onUpload} disabled={uploading} className="btn btn-soft !py-1.5 text-sm">
          {uploading ? 'Uploading…' : `Upload ${cat.label.replace(/s$/, '')}`}
        </button>
      </div>
      {files.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-purple-soft/40 bg-white/30 px-4 py-3 text-xs text-muted">
          No {cat.label.toLowerCase()} yet{cat.hint ? ` — ${cat.hint}.` : '.'}
        </div>
      ) : (
        <div className="glass-card divide-y divide-white/40 overflow-hidden">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-lg">{cat.icon}</span>
              <button type="button" onClick={() => onOpen(f)} className="min-w-0 flex-1 text-left" title="Open / download">
                <div className="truncate text-sm font-semibold text-ink hover:text-brand-600">{f.filename}</div>
                <div className="text-xs text-muted">{fmtSize(f.sizeBytes)} · {fmtDate(f.uploadedAt)}</div>
              </button>
              <button type="button" onClick={() => onDelete(f)} className="text-xs font-semibold text-muted transition hover:text-rose-500">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---- Record lecture (MediaRecorder) ------------------------------------ */
function RecordButton({ classId, onSaved, onView, onError }) {
  const [state, setState] = useState('idle'); // idle | recording | saving
  const [seconds, setSeconds] = useState(0);
  const rec = useRef({ mr: null, chunks: [], stream: null, timer: null });

  const cleanup = () => {
    const r = rec.current;
    if (r.timer) clearInterval(r.timer);
    if (r.stream) r.stream.getTracks().forEach((t) => t.stop());
    rec.current = { mr: null, chunks: [], stream: null, timer: null };
  };

  const start = async () => {
    onError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Recording is not supported in this browser. Upload a transcript instead.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      onError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your browser settings, or upload a transcript instead.'
          : 'Could not start recording. Upload a transcript instead.',
      );
      return;
    }
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      const elapsed = seconds;
      cleanup();
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      setState('saving');
      try {
        const fd = new FormData();
        fd.append('audio', blob, 'lecture.webm');
        fd.append('durationSeconds', String(elapsed));
        fd.append('recordedDate', new Date().toISOString().slice(0, 10));
        const { data } = await api.post(`/api/classes/${classId}/transcripts/record`, fd);
        await onSaved();
        // No auto-transcription → open it so the student can paste the text.
        if (data.transcript && !data.transcript.content) onView(data.transcript);
      } catch (err) {
        onError(errorMessage(err, 'Could not save the recording.'));
      } finally {
        setState('idle');
        setSeconds(0);
      }
    };
    rec.current = { mr, chunks, stream, timer: setInterval(() => setSeconds((s) => s + 1), 1000) };
    mr.start();
    setSeconds(0);
    setState('recording');
  };

  const stop = () => {
    if (rec.current.mr && rec.current.mr.state !== 'inactive') rec.current.mr.stop();
  };

  useEffect(() => () => cleanup(), []);

  if (state === 'recording') {
    return (
      <button onClick={stop} className="btn btn-danger !py-1.5 text-sm">
        <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
        Stop · {fmtDuration(seconds)}
      </button>
    );
  }
  return (
    <button onClick={start} disabled={state === 'saving'} className="btn btn-primary !py-1.5 text-sm">
      {state === 'saving' ? 'Saving…' : '● Record lecture'}
    </button>
  );
}

/* ---- Upload / paste transcript ----------------------------------------- */
function UploadTranscriptModal({ classId, onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', content: '', recordedDate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('upload');

  const readTxt = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      setForm((f) => ({ ...f, content: String(reader.result || ''), title: f.title || file.name.replace(/\.[^.]+$/, '') }));
    reader.readAsText(file);
    setSource('upload');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.content.trim()) {
      setError('Paste the transcript text or choose a .txt file.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/classes/${classId}/transcripts`, {
        title: form.title.trim() || undefined,
        content: form.content,
        source,
        recordedDate: form.recordedDate || null,
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save transcript.'));
      setSaving(false);
    }
  };

  return (
    <Modal title="Upload transcript" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Title</span>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Lecture 1" className="field" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Lecture date</span>
            <input type="date" value={form.recordedDate} onChange={(e) => setForm((f) => ({ ...f, recordedDate: e.target.value }))} className="field" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs font-semibold text-ink">
            Transcript text
            <span className="font-normal text-muted">
              or{' '}
              <label className="cursor-pointer font-semibold text-brand-600 hover:underline">
                load a .txt file
                <input type="file" accept=".txt,text/plain" className="hidden" onChange={readTxt} />
              </label>
            </span>
          </span>
          <textarea
            value={form.content}
            onChange={(e) => { setForm((f) => ({ ...f, content: e.target.value })); setSource('paste'); }}
            rows={8}
            placeholder="Paste the lecture transcript here…"
            className="field"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save transcript'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- View / edit a transcript ------------------------------------------ */
function TranscriptModal({ transcript, onClose, onSaved }) {
  const [content, setContent] = useState(transcript.content || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = content !== (transcript.content || '');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/transcripts/${transcript.id}`, { content });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save.'));
      setSaving(false);
    }
  };

  const downloadTxt = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcript.title || 'transcript'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <Modal title={transcript.title} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="text-xs text-muted">
          {[fmtDay(transcript.recordedDate), fmtDuration(transcript.durationSeconds), SOURCE_LABEL[transcript.source]]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {!transcript.content && (
          <div className="rounded-xl border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-sm text-amber-700">
            This recording has no transcript text yet (automatic transcription isn’t configured). Paste the
            transcript below and save.
          </div>
        )}
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={14} className="field" placeholder="Transcript text…" />
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={downloadTxt} disabled={!content} className="text-xs font-semibold text-muted transition hover:text-ink disabled:opacity-40">
            ↓ Download .txt
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-soft">Close</button>
            <button type="button" onClick={save} disabled={saving || !dirty} className="btn btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
