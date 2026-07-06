import { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_URL, errorMessage } from '../../api/client';
import { Spinner, ErrorBanner, EmptyState } from '../ui';

/** Podcasts: list, generate (premium), and play with an HTML5 audio player. */
export function PodcastTab({ classId, flash }) {
  const [podcasts, setPodcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/learn/classes/${classId}/podcasts`);
      setPodcasts(data.podcasts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true); setError('');
    try {
      await api.post(`/api/learn/classes/${classId}/podcasts/generate`, {});
      flash('Podcast generated');
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading podcasts…" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn btn-soft" disabled={busy} onClick={generate}>{busy ? 'Generating…' : '✦ Generate podcast'}</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {podcasts.length === 0 ? (
        <EmptyState title="No podcasts yet">Generate a two-host “deep dive” conversation from this class's material.</EmptyState>
      ) : (
        <div className="space-y-3">{podcasts.map((p) => <PodcastCard key={p.id} podcast={p} />)}</div>
      )}
    </div>
  );
}

function fmt(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function PodcastCard({ podcast }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [rate, setRate] = useState(1);
  const audioRef = useRef(null);
  const saved = useRef(0);

  // Persist completion percentage as it plays (throttled to ~10% steps).
  const onTime = () => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const pct = Math.round((a.currentTime / a.duration) * 100);
    if (pct >= saved.current + 10) {
      saved.current = pct;
      api.post(`/api/learn/podcasts/${podcast.id}/listen`, { completionPercent: pct }).catch(() => {});
    }
  };
  const setSpeed = (r) => { setRate(r); if (audioRef.current) audioRef.current.playbackRate = r; };

  return (
    <div className="glass-panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{podcast.title}</p>
          <p className="text-xs text-muted">{fmt(podcast.durationSeconds)} · from {podcast.generatedFrom?.join(' + ') || 'class material'}</p>
        </div>
        {podcast.completionPercent > 0 && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-bold text-emerald-600">{podcast.completionPercent}% listened</span>}
      </div>

      {podcast.audioUrl ? (
        <>
          <audio ref={audioRef} controls preload="none" onTimeUpdate={onTime} className="w-full">
            <source src={`${API_URL}${podcast.audioUrl}`} type="audio/mpeg" />
          </audio>
          <div className="flex items-center gap-1 text-xs text-muted">
            Speed:
            {[1, 1.25, 1.5].map((r) => (
              <button key={r} onClick={() => setSpeed(r)} className={`rounded px-1.5 py-0.5 font-semibold ${rate === r ? 'bg-brand-500/20 text-brand-700' : 'hover:bg-white/50'}`}>{r}×</button>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-700">
          🎙️ Audio is pending — set <code>ELEVENLABS_API_KEY</code> to synthesize narration. The full dialogue is below.
        </p>
      )}

      <button onClick={() => setShowTranscript((s) => !s)} className="text-sm font-semibold text-brand-600">
        {showTranscript ? 'Hide' : 'Show'} transcript
      </button>
      {showTranscript && <DialogueTranscript text={podcast.transcript} />}
    </div>
  );
}

/** Render a "Name: line" dialogue transcript with the speaker names emphasized. */
function DialogueTranscript({ text }) {
  const turns = (text || '').split(/\n\n+/).filter(Boolean);
  return (
    <div className="space-y-2 border-t border-white/40 pt-2 text-sm">
      {turns.map((t, i) => {
        const m = t.match(/^([^:\n]{1,24}):\s*([\s\S]*)$/);
        if (!m) return <p key={i} className="whitespace-pre-wrap text-muted">{t}</p>;
        return (
          <p key={i} className="whitespace-pre-wrap text-muted">
            <span className="font-semibold text-brand-600">{m[1]}:</span> {m[2]}
          </p>
        );
      })}
    </div>
  );
}
