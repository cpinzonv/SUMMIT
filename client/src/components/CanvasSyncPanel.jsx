import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ErrorBanner } from './ui';

/** Compact "x minutes/hours/days ago" (or "just now"). */
function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function fmtDue(iso) {
  if (!iso) return 'No due date';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Synced from Canvas" pill — marks read-only, Canvas-sourced rows. */
function CanvasTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-ink backdrop-blur">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#e2410b' }} />
      🔗 Synced from Canvas
    </span>
  );
}

/**
 * Assignments-tab panel for a class linked to Canvas: shows the last sync time,
 * a "Sync from Canvas" button, and the read-only assignments already pulled INTO
 * Summit (from canvas_synced_assignments — not a live Canvas call).
 */
export function CanvasSyncPanel({ classId, onToast }) {
  const [data, setData] = useState({ assignments: [], lastSyncedAt: null, count: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const fetchSynced = useCallback(async () => {
    try {
      const { data: res } = await api.get(`/api/classes/${classId}/canvas/assignments`);
      setData(res);
    } catch (err) {
      setError(errorMessage(err, 'Could not load synced Canvas assignments.'));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    fetchSynced();
  }, [fetchSynced]);

  const sync = async () => {
    setSyncing(true);
    setError('');
    try {
      const { data: res } = await api.post(`/api/classes/${classId}/canvas/sync`);
      onToast?.({ type: 'success', msg: res.message || 'Synced from Canvas' });
      await fetchSynced();
    } catch (err) {
      setError(errorMessage(err, 'Canvas sync failed. Please try again.'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="glass-card mb-5 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            Canvas assignments <CanvasTag />
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Read-only, pulled from Canvas. Last synced: {timeAgo(data.lastSyncedAt)}
            {data.count ? ` · ${data.count} synced` : ''}
          </p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="btn btn-primary flex items-center gap-2"
        >
          {syncing && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {syncing ? 'Syncing…' : 'Sync from Canvas'}
        </button>
      </div>

      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.assignments.length === 0 ? (
        <p className="rounded-2xl border border-white/50 bg-white/40 px-4 py-3 text-sm text-muted">
          No Canvas assignments synced yet. Click <span className="font-semibold text-ink">Sync from Canvas</span> to
          pull them in.
        </p>
      ) : (
        <ul className="divide-y divide-white/40">
          {data.assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{a.name}</div>
                <div className="text-xs text-muted">Due {fmtDue(a.dueDate)}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold text-ink">
                  {a.pointsPossible != null ? `${a.pointsPossible} pts` : '—'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
