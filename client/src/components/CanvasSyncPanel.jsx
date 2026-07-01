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

/**
 * Subtle "Canvas" source tag — a tiny, understated glass chip (thin border,
 * muted teal-gray, a small link glyph) that marks Canvas-sourced rows without
 * drawing attention.
 */
function CanvasTag() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-slate-300/40 bg-white/30 px-1.5 py-px text-[10px] font-medium leading-none text-slate-400 backdrop-blur-sm"
      title="Synced from Canvas"
    >
      <svg
        width="8"
        height="8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
      Canvas
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
