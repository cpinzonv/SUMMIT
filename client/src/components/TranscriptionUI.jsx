/**
 * TranscriptionUI — the transcribe → summarize → move-to-notes flow for a lecture
 * recording, rendered inside the transcript detail modal (see ClassFiles).
 *
 * Production-polished: no emojis, no manual Save button (transcript edits
 * auto-save on blur), Claude summaries are stripped of Markdown for clean text,
 * and a "Keep audio file" toggle (default ON) governs whether the raw recording
 * is deleted when the modal closes / after Move to Notes — the parent modal owns
 * that cleanup so it fires on every close path (X / backdrop / Escape / Close).
 *
 * Backend (owner-scoped, graceful 503 when a provider key is unset):
 *   POST  /api/transcripts/:id/transcribe     Whisper → fills transcript text
 *   POST  /api/transcripts/:id/summary        Claude  → { summary }
 *   POST  /api/transcripts/:id/move-to-notes  → creates a class note { noteId }
 *   PATCH /api/transcripts/:id                saves edited transcript text
 *
 * The transcript already lives in the `transcripts` table and shows in the Files
 * tab under "Transcripts"; transcribing just fills its text — no new row.
 */
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Toast, Toggle } from './ui';

function InlineSpinner() {
  return (
    <span
      className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"
      aria-hidden="true"
    />
  );
}

/** Strip Markdown to plain, readable text for the summary display. */
function cleanSummary(md) {
  return String(md || '')
    .replace(/^\s*#{1,6}\s+/gm, '')        // # headers
    .replace(/\*\*(.+?)\*\*/g, '$1')       // **bold**
    .replace(/__(.+?)__/g, '$1')           // __bold__
    .replace(/\*(.+?)\*/g, '$1')           // *italic* / stray *
    .replace(/`([^`]+)`/g, '$1')           // `code`
    .replace(/^\s*[-*+]\s+/gm, '• ')       // bullets → •
    .replace(/\n{3,}/g, '\n\n')            // collapse blank runs
    .trim();
}

export function TranscriptionUI({
  transcript,
  autoTranscription = false,
  hasAudio = false,
  keepAudio = true,
  onToggleKeepAudio,
  onChanged,
  onMoved,
}) {
  const [content, setContent] = useState(transcript.content || '');
  const [summary, setSummary] = useState(transcript.summary || '');
  const [busy, setBusy] = useState(''); // '' | 'transcribe' | 'summarize' | 'move'
  const [toast, setToast] = useState(null);
  const savedContent = useRef(transcript.content || '');
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = (msg, type = 'success') => setToast({ type, msg });
  const anyBusy = Boolean(busy);

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) flash(okMsg);
    } catch (err) {
      flash(errorMessage(err, 'Something went wrong.'), 'error');
    } finally {
      if (mounted.current) setBusy('');
    }
  };

  const transcribe = () =>
    run('transcribe', async () => {
      const { data } = await api.post(`/api/transcripts/${transcript.id}/transcribe`);
      setContent(data.transcript.content || '');
      savedContent.current = data.transcript.content || '';
      onChanged?.();
    }, 'Transcript ready');

  // Auto-save edits on blur — no Save button.
  const saveOnBlur = async () => {
    if (content === savedContent.current) return;
    try {
      await api.patch(`/api/transcripts/${transcript.id}`, { content });
      savedContent.current = content;
      onChanged?.();
    } catch (err) {
      flash(errorMessage(err, 'Could not save the transcript.'), 'error');
    }
  };

  const generateSummary = () =>
    run('summarize', async () => {
      const { data } = await api.post(`/api/transcripts/${transcript.id}/summary`);
      setSummary(data.summary || '');
      onChanged?.();
    }, 'Summary generated');

  const moveToNotes = () =>
    run('move', async () => {
      await api.post(`/api/transcripts/${transcript.id}/move-to-notes`);
      flash('Moved to Notes');
      onMoved?.(); // parent deletes audio if the toggle is off, then navigates
    });

  return (
    <div className="space-y-4">
      {/* Transcribe (audio + Whisper on) or the manual-paste notice. */}
      {!content && hasAudio && (
        autoTranscription ? (
          <button type="button" onClick={transcribe} disabled={anyBusy} className="btn btn-primary">
            {busy === 'transcribe' ? <><InlineSpinner />Transcribing…</> : 'Transcribe'}
          </button>
        ) : (
          <div className="rounded-xl border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-sm text-amber-700">
            Automatic transcription isn’t configured. Paste the transcript text below.
          </div>
        )
      )}

      {/* Transcript (auto-saves on blur). */}
      <div>
        <span className="mb-1 block text-sm font-semibold text-ink">Transcript</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={saveOnBlur}
          rows={8}
          placeholder="Transcript text…"
          disabled={anyBusy}
          className="field"
        />
      </div>

      {/* Summary. */}
      <div>
        <button type="button" onClick={generateSummary} disabled={!content.trim() || anyBusy} className="btn btn-soft">
          {busy === 'summarize' ? <><InlineSpinner />Summarizing…</> : summary ? 'Regenerate Summary' : 'Generate Summary'}
        </button>
        {summary && (
          <div className="mt-3 rounded-xl border border-white/60 bg-white/50 p-3">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-600">Summary</div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{cleanSummary(summary)}</div>
            <div className="mt-3">
              <button type="button" onClick={moveToNotes} disabled={anyBusy} className="btn btn-primary !py-1.5 text-sm">
                {busy === 'move' ? <><InlineSpinner />Moving…</> : 'Move to Notes'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Keep-audio toggle (default ON). Off → the recording is deleted when this
          closes or after Move to Notes (handled by the parent modal). */}
      {hasAudio && (
        <div className="flex items-center justify-between rounded-xl border border-white/60 bg-white/40 px-3 py-2">
          <div>
            <div className="text-sm font-semibold text-ink">Keep audio file</div>
            <div className="text-xs text-muted">{keepAudio ? 'Kept in Files' : 'Deleted when you close this'}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold ${keepAudio ? 'text-emerald-600' : 'text-muted'}`}>{keepAudio ? 'ON' : 'OFF'}</span>
            <Toggle on={keepAudio} onChange={onToggleKeepAudio} />
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}

export default TranscriptionUI;
