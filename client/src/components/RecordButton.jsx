/**
 * RecordButton — capture a lecture with the mic (MediaRecorder) and save it as a
 * class recording (audio file + transcript) via POST /classes/:id/transcripts/record.
 * Shared by the Files tab and the Notes tab so recording works from either place.
 *
 * Props:
 *   classId
 *   onError(msg)                      surface a user-facing error string
 *   onRecorded(transcript, meta)      called after the recording is saved;
 *                                      meta = { transcribed: boolean }
 *   label                             idle-button label (default 'Record lecture')
 */
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';

const MicIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
  </svg>
);

function fmtClock(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function RecordButton({ classId, onError, onRecorded, label = 'Record lecture' }) {
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
    onError?.('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError?.('Recording is not supported in this browser. Upload a transcript instead.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      onError?.(
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
        onRecorded?.(data.transcript, { transcribed: data.transcribed });
      } catch (err) {
        onError?.(errorMessage(err, 'Could not save the recording.'));
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
      <button type="button" onClick={stop} className="btn btn-danger !py-1.5 text-sm">
        <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white align-middle" />
        Stop · {fmtClock(seconds)}
      </button>
    );
  }
  return (
    <button type="button" onClick={start} disabled={state === 'saving'} className="btn btn-soft !py-1.5 text-sm">
      <MicIcon className="mr-1.5 inline-block h-4 w-4 align-[-3px]" />
      {state === 'saving' ? 'Saving…' : label}
    </button>
  );
}

export default RecordButton;
