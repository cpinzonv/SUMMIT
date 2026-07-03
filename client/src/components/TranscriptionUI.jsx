/**
 * TranscriptionUI — the transcribe → summarize → move-to-notes flow for a lecture
 * recording, rendered inside the transcript detail modal (see ClassFiles).
 *
 * Backend (all owner-scoped, graceful 503 when a provider key is unset):
 *   POST   /api/transcripts/:id/transcribe     Whisper → fills transcript text
 *   POST   /api/transcripts/:id/summary        Claude  → { summary }
 *   POST   /api/transcripts/:id/move-to-notes  → creates a class note { noteId }
 *   DELETE /api/transcripts/:id/audio?keepAudio=  drops just the audio recording
 *   PATCH  /api/transcripts/:id                saves edited transcript text
 *
 * States: idle / transcribing / summarizing / moving / deleting — each with a
 * spinner and disabled controls. All actions toast; errors show friendly text.
 */
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Toast } from './ui';

function InlineSpinner() {
  return (
    <span
      className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"
      aria-hidden="true"
    />
  );
}

function fmtDuration(s) {
  if (s == null) return null;
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  return `${m} min`;
}

export function TranscriptionUI({ transcript, autoTranscription = false, onChanged, onGoToNotes, onClose }) {
  const [content, setContent] = useState(transcript.content || '');
  const [summary, setSummary] = useState(transcript.summary || '');
  const [audioFileId, setAudioFileId] = useState(transcript.audioFileId || null);
  const [keepAudio, setKeepAudio] = useState(true);
  const [busy, setBusy] = useState(''); // '', 'transcribe', 'summarize', 'save', 'move', 'deleteAudio'
  const [toast, setToast] = useState(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = (msg, type = 'success') => setToast({ type, msg });
  const dirty = content !== (transcript.content || '');
  const anyBusy = Boolean(busy);

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      const out = await fn();
      if (okMsg) flash(okMsg);
      return out;
    } catch (err) {
      flash(errorMessage(err, 'Something went wrong.'), 'error');
      return null;
    } finally {
      if (mounted.current) setBusy('');
    }
  };

  const transcribe = () =>
    run('transcribe', async () => {
      const { data } = await api.post(`/api/transcripts/${transcript.id}/transcribe`);
      setContent(data.transcript.content || '');
      onChanged?.(data.transcript);
    }, 'Transcript ready');

  const saveText = () =>
    run('save', async () => {
      const { data } = await api.patch(`/api/transcripts/${transcript.id}`, { content });
      onChanged?.(data.transcript);
    }, 'Saved');

  const generateSummary = () =>
    run('summarize', async () => {
      const { data } = await api.post(`/api/transcripts/${transcript.id}/summary`);
      setSummary(data.summary || '');
      onChanged?.(data.transcript);
    }, 'Summary generated');

  const moveToNotes = () =>
    run('move', async () => {
      await api.post(`/api/transcripts/${transcript.id}/move-to-notes`);
      flash('Moved to Notes');
      onGoToNotes?.();
      onClose?.();
    });

  const deleteAudio = () =>
    run('deleteAudio', async () => {
      if (keepAudio) { flash('Kept the audio file'); return; }
      const { data } = await api.delete(`/api/transcripts/${transcript.id}/audio?keepAudio=false`);
      setAudioFileId(null);
      onChanged?.(data.transcript);
      flash('Audio deleted');
    });

  const durationLabel = fmtDuration(transcript.durationSeconds);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden="true">🎙️</span>
        <span className="truncate">{transcript.title}</span>
        {durationLabel && <span className="font-normal text-muted">· {durationLabel}</span>}
      </div>

      {/* Transcribe / no-STT notice */}
      {!content && audioFileId && (
        autoTranscription ? (
          <button type="button" onClick={transcribe} disabled={anyBusy} className="btn btn-primary">
            {busy === 'transcribe' ? <><InlineSpinner />Transcribing…</> : 'Transcribe'}
          </button>
        ) : (
          <div className="rounded-xl border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-sm text-amber-700">
            Automatic transcription isn’t configured. Paste the transcript text below and save.
          </div>
        )
      )}

      {/* Transcript text (editable) */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-ink">Transcript</span>
          {content && (
            <button type="button" onClick={saveText} disabled={!dirty || anyBusy} className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-40">
              {busy === 'save' ? 'Saving…' : dirty ? 'Save edits' : 'Saved'}
            </button>
          )}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="Transcript text…"
          disabled={anyBusy && busy !== 'save'}
          className="field"
        />
      </div>

      {/* Summary */}
      <div>
        <button type="button" onClick={generateSummary} disabled={!content.trim() || anyBusy} className="btn btn-soft">
          {busy === 'summarize' ? <><InlineSpinner />Summarizing…</> : summary ? 'Regenerate Summary' : 'Generate Summary'}
        </button>
        {summary && (
          <div className="mt-3 rounded-xl border border-white/60 bg-white/50 p-3">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-600">Summary</div>
            <div className="whitespace-pre-wrap text-sm text-ink">{summary}</div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={moveToNotes} disabled={anyBusy} className="btn btn-primary !py-1.5 text-sm">
                {busy === 'move' ? <><InlineSpinner />Moving…</> : 'Move to Notes'}
              </button>
              {audioFileId && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={deleteAudio} disabled={anyBusy} className="btn btn-soft !py-1.5 text-sm text-rose-600">
                    {busy === 'deleteAudio' ? <><InlineSpinner />Working…</> : 'Delete Audio'}
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
                    Keep audio file
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  );
}

export default TranscriptionUI;
