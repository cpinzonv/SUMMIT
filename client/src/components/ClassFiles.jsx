import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, Modal } from './ui';
import { TranscriptionUI } from './TranscriptionUI';

/* ---- line icons (2px stroke, currentColor) ----------------------------- */
const svg = (children) =>
  function Icon({ className = '' }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    );
  };
const PdfIcon = svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>);
const SlidesIcon = svg(<><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4M8.5 20h7M8 9l2.5 2L8 13" /></>);
const MicIcon = svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></>);
const BookIcon = svg(<><path d="M12 6C10 4.5 7 4.5 4 5v13c3-.5 6-.5 8 1 2-1.5 5-1.5 8-1V5c-3-.5-6-.5-8 1z" /><path d="M12 6v13" /></>);
const GridIcon = svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>);
const FileIcon = svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>);

// Category config. `key` matches the stored file category; transcripts are a
// separate data source (their own table) flagged with isTranscript.
const CATS = [
  { key: 'pdf', label: 'PDFs', color: '#ff7a52', Icon: PdfIcon, hint: 'Syllabus, handouts, notes' },
  { key: 'slides', label: 'Slides', color: '#ff9a3d', Icon: SlidesIcon, hint: 'Lecture presentations' },
  { key: 'transcript', label: 'Transcripts', color: '#20b2aa', Icon: MicIcon, hint: 'Record or upload a lecture', isTranscript: true },
  { key: 'textbook', label: 'Textbooks', color: '#5aa9d6', Icon: BookIcon, hint: 'eBooks, textbook PDFs' },
  { key: 'formula_sheet', label: 'Formula Sheets', color: '#7e8fe0', Icon: GridIcon, hint: 'Quick reference' },
];
const OTHER_CAT = { key: 'other', label: 'Other', color: '#8a93a6', Icon: FileIcon };
const DOC_KEYS = ['pdf', 'slides', 'textbook', 'formula_sheet'];
const singular = (label) => label.replace(/s$/, '');

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
  return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDuration(s) {
  if (s == null) return null;
  const sec = s % 60;
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
const SOURCE_LABEL = { recording: 'Recording', paste: 'Pasted', upload: 'Uploaded' };

/**
 * Files tab: dynamic category tabs that appear only once a category has files
 * (or transcripts). Empty state shows a big "+" and a Record button. The "+"
 * opens a type chooser; recording is always available without the chooser.
 */
export function ClassFiles({ classId, onGoToNotes }) {
  const [files, setFiles] = useState(null);
  const [transcripts, setTranscripts] = useState(null);
  const [autoTranscription, setAutoTranscription] = useState(false);
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');
  const [uploadingCat, setUploadingCat] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [modal, setModal] = useState(null); // {type:'uploadTranscript'} | {type:'viewTranscript',transcript}

  const pendingCat = useRef('pdf');
  const fileInput = useRef(null);

  const loadFiles = () =>
    api.get(`/api/classes/${classId}/files`).then((r) => setFiles(r.data.files)).catch((e) => setError(errorMessage(e)));
  const loadTranscripts = () =>
    api
      .get(`/api/classes/${classId}/transcripts`)
      .then((r) => {
        setTranscripts(r.data.transcripts);
        setAutoTranscription(!!r.data.autoTranscription);
      })
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    loadFiles();
    loadTranscripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const ready = files !== null && transcripts !== null;
  const countOf = (cat) =>
    cat.isTranscript ? (transcripts?.length ?? 0) : (files || []).filter((f) => f.category === cat.key).length;
  const otherFiles = (files || []).filter((f) => f.category !== 'audio' && !DOC_KEYS.includes(f.category));

  // Tabs for categories that currently have content (+ Other if any legacy files).
  const tabs = [...CATS.filter((c) => countOf(c) > 0), ...(otherFiles.length ? [OTHER_CAT] : [])];

  // Keep the active tab valid as categories appear/disappear.
  useEffect(() => {
    if (!ready) return;
    const keys = tabs.map((t) => t.key);
    if (active && keys.includes(active)) return;
    setActive(keys[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, files, transcripts]);

  /* ---- uploads -------------------------------------------------------- */
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
      setActive(category); // reveal/focus the category's tab
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
      await loadFiles();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete file'));
    }
  };
  const deleteTranscript = async (tr) => {
    if (!confirm(`Delete "${tr.title}"?`)) return;
    try {
      await api.delete(`/api/transcripts/${tr.id}`);
      await loadTranscripts();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete transcript'));
    }
  };

  // Picking a type from the "+" chooser.
  const pickType = (cat) => {
    setAddOpen(false);
    if (cat.isTranscript) setModal({ type: 'uploadTranscript' });
    else pickFor(cat.key);
  };

  const activeCat = [...CATS, OTHER_CAT].find((c) => c.key === active);

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-2xl border border-rose-300/50 bg-rose-50/70 px-4 py-2.5 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      <input ref={fileInput} type="file" multiple className="hidden" onChange={onFilePicked} />

      {!ready ? (
        <Spinner label="Loading files…" />
      ) : tabs.length === 0 ? (
        /* ---- Empty state ---- */
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Add files"
            className="grid h-20 w-20 place-items-center rounded-full text-white shadow-lg transition hover:scale-105 active:scale-95"
            style={{ backgroundImage: 'var(--grad-teal-purple)' }}
          >
            <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <p className="text-sm font-semibold text-muted">Add files to get started</p>
          <RecordButton classId={classId} onSaved={loadTranscripts} onRecorded={() => setActive('transcript')} onView={(tr) => setModal({ type: 'viewTranscript', transcript: tr })} onError={setError} />
        </div>
      ) : (
        <>
          {/* ---- Tab bar ---- */}
          <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-white/50">
            {tabs.map((c) => {
              const on = active === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setActive(c.key)}
                  className="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition"
                  style={{ color: on ? c.color : 'var(--color-muted)', borderColor: on ? c.color : 'transparent' }}
                >
                  <c.Icon className="h-4 w-4" />
                  {c.label} ({countOf(c)})
                </button>
              );
            })}
            <button
              onClick={() => setAddOpen(true)}
              title="Add files"
              aria-label="Add files"
              className="ml-1 grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-white/70 hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <div className="ml-auto py-1">
              <RecordButton classId={classId} onSaved={loadTranscripts} onRecorded={() => setActive('transcript')} onView={(tr) => setModal({ type: 'viewTranscript', transcript: tr })} onError={setError} />
            </div>
          </div>

          {/* ---- Active panel ---- */}
          {activeCat?.isTranscript ? (
            <TranscriptsPanel
              transcripts={transcripts}
              onUpload={() => setModal({ type: 'uploadTranscript' })}
              onView={(tr) => setModal({ type: 'viewTranscript', transcript: tr })}
              onOpenAudio={(id) => openFile({ id })}
              onDelete={deleteTranscript}
            />
          ) : activeCat ? (
            <FilePanel
              cat={activeCat}
              files={activeCat.key === 'other' ? otherFiles : files.filter((f) => f.category === activeCat.key)}
              uploading={uploadingCat === activeCat.key}
              onUpload={() => pickFor(activeCat.key)}
              onOpen={openFile}
              onDelete={deleteFile}
            />
          ) : null}
        </>
      )}

      {addOpen && <AddTypeModal onPick={pickType} onClose={() => setAddOpen(false)} />}
      {modal?.type === 'uploadTranscript' && (
        <UploadTranscriptModal
          classId={classId}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadTranscripts();
            setActive('transcript');
          }}
        />
      )}
      {modal?.type === 'viewTranscript' && (
        <TranscriptModal
          transcript={modal.transcript}
          autoTranscription={autoTranscription}
          onClose={() => setModal(null)}
          onChanged={loadTranscripts}
          onGoToNotes={onGoToNotes}
        />
      )}
    </div>
  );
}

/* ---- Type chooser ("+") ------------------------------------------------- */
function AddTypeModal({ onPick, onClose }) {
  return (
    <Modal title="What would you like to add?" onClose={onClose}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => onPick(c)}
            className="flex items-center gap-3 rounded-xl border border-white/60 bg-white/50 px-4 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/85"
          >
            <span style={{ color: c.color }}><c.Icon className="h-6 w-6" /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink">{c.label}</span>
              <span className="block text-xs text-muted">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---- Document category panel ------------------------------------------- */
function FilePanel({ cat, files, uploading, onUpload, onOpen, onDelete }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: cat.color }}>
          <cat.Icon className="h-4 w-4" /> {cat.label}
        </h3>
        {cat.key !== 'other' && (
          <button onClick={onUpload} disabled={uploading} className="btn btn-soft !py-1.5 text-sm">
            {uploading ? 'Uploading…' : `Upload ${singular(cat.label)}`}
          </button>
        )}
      </div>
      <div className="glass-card divide-y divide-white/40 overflow-hidden">
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
            <span style={{ color: cat.color }}><cat.Icon className="h-5 w-5" /></span>
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
    </div>
  );
}

/* ---- Transcripts panel -------------------------------------------------- */
function TranscriptsPanel({ transcripts, onUpload, onView, onOpenAudio, onDelete }) {
  const [search, setSearch] = useState('');
  const filtered = transcripts.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (t.title || '').toLowerCase().includes(q) || (t.content || '').toLowerCase().includes(q);
  });
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: '#20b2aa' }}>
          <MicIcon className="h-4 w-4" /> Transcripts
        </h3>
        <button onClick={onUpload} className="btn btn-soft !py-1.5 text-sm">Upload transcript</button>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transcripts…" className="field mb-2" />
      <div className="glass-card divide-y divide-white/40 overflow-hidden">
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No transcripts match “{search}”.</p>
        ) : (
          filtered.map((tr) => (
            <div key={tr.id} className="flex items-center gap-3 px-4 py-2.5">
              <span style={{ color: '#20b2aa' }}><MicIcon className="h-5 w-5" /></span>
              <button type="button" onClick={() => onView(tr)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-semibold text-ink hover:text-brand-600">
                  {tr.title}
                  {!tr.content && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Needs text</span>}
                </div>
                <div className="text-xs text-muted">
                  {[fmtDay(tr.recordedDate) || fmtDate(tr.createdAt), fmtDuration(tr.durationSeconds), SOURCE_LABEL[tr.source]].filter(Boolean).join(' · ')}
                </div>
              </button>
              {tr.audioFileId && (
                <button type="button" onClick={() => onOpenAudio(tr.audioFileId)} className="text-xs font-semibold text-brand-600 transition hover:underline" title="Play / download audio">
                  ▶ Audio
                </button>
              )}
              <button type="button" onClick={() => onDelete(tr)} className="text-xs font-semibold text-muted transition hover:text-rose-500">Delete</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---- Record lecture (MediaRecorder) ------------------------------------ */
function RecordButton({ classId, onSaved, onRecorded, onView, onError }) {
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
        onRecorded?.();
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

/* ---- View a transcript: transcribe → summarize → move-to-notes --------- */
function TranscriptModal({ transcript, autoTranscription, onClose, onChanged, onGoToNotes }) {
  // Keep the recording by default; when off, drop it on any close / after move.
  const [keepAudio, setKeepAudio] = useState(true);

  // Best-effort: delete just the audio (keeps the transcript text) when the
  // toggle is off. Fire-and-forget so closing stays instant.
  const cleanupAudio = () => {
    if (keepAudio || !transcript.audioFileId) return;
    api
      .delete(`/api/transcripts/${transcript.id}/audio?keepAudio=false`)
      .then(() => onChanged?.())
      .catch(() => {});
  };
  const handleClose = () => { cleanupAudio(); onClose(); };
  const handleMoved = () => { cleanupAudio(); (onGoToNotes || onClose)(); };

  return (
    <Modal title={transcript.title} onClose={handleClose} wide>
      <div className="space-y-3">
        <div className="text-xs text-muted">
          {[fmtDay(transcript.recordedDate), fmtDuration(transcript.durationSeconds), SOURCE_LABEL[transcript.source]].filter(Boolean).join(' · ')}
        </div>
        <TranscriptionUI
          transcript={transcript}
          autoTranscription={autoTranscription}
          hasAudio={!!transcript.audioFileId}
          keepAudio={keepAudio}
          onToggleKeepAudio={() => setKeepAudio((v) => !v)}
          onChanged={onChanged}
          onMoved={handleMoved}
        />
        <div className="flex justify-end pt-1">
          <button type="button" onClick={handleClose} className="btn btn-soft">Close</button>
        </div>
      </div>
    </Modal>
  );
}
