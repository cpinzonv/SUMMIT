import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Spinner, ErrorBanner, EmptyState } from '../ui';
import { renderMarkdown } from '../../utils/markdown';

/** Study guides: list, generate (premium), and read (markdown + TOC + print). */
export function GuideTab({ classId, flash }) {
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/learn/classes/${classId}/guides`);
      setGuides(data.guides);
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
      const { data } = await api.post(`/api/learn/classes/${classId}/guides/generate`, {});
      flash('Study guide generated');
      setActiveId(data.guide.id);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (activeId) return <GuideViewer guideId={activeId} onExit={() => { setActiveId(null); load(); }} onFlash={flash} />;
  if (loading) return <Spinner label="Loading study guides…" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn btn-soft" disabled={busy} onClick={generate}>{busy ? 'Generating…' : '✦ Generate study guide'}</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {guides.length === 0 ? (
        <EmptyState title="No study guides yet">Generate a summarized guide of key concepts from this class.</EmptyState>
      ) : (
        <div className="space-y-2">
          {guides.map((g) => (
            <button key={g.id} onClick={() => setActiveId(g.id)} className="glass-panel flex w-full items-center justify-between p-4 text-left transition hover:shadow-md">
              <div>
                <p className="font-semibold text-ink">{g.bookmarked ? '★ ' : ''}{g.title}</p>
                <p className="text-xs text-muted">{g.readAt ? 'Read' : 'Unread'} · {new Date(g.generatedAt).toLocaleDateString()}</p>
              </div>
              <span className="text-sm font-semibold text-brand-600">Open →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GuideViewer({ guideId, onExit, onFlash }) {
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/api/learn/guides/${guideId}`);
        setGuide(data.guide);
        api.post(`/api/learn/guides/${guideId}/read`, { completed: true }).catch(() => {});
      } catch (e) { setError(errorMessage(e)); }
    })();
  }, [guideId]);

  const toc = useMemo(() => {
    if (!guide?.content) return [];
    return [...guide.content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  }, [guide]);

  const toggleBookmark = async () => {
    try {
      const { data } = await api.post(`/api/learn/guides/${guideId}/read`, { bookmarked: !guide.bookmarked });
      setGuide(data.guide);
      onFlash(data.guide.bookmarked ? 'Bookmarked' : 'Bookmark removed');
    } catch (e) { onFlash(errorMessage(e), 'error'); }
  };

  if (error) return <div className="space-y-3"><ErrorBanner message={error} /><button className="btn btn-soft" onClick={onExit}>← Back</button></div>;
  if (!guide) return <Spinner label="Loading guide…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="text-sm text-muted hover:text-ink" onClick={onExit}>← Back to guides</button>
        <div className="flex gap-2">
          <button className="btn btn-soft" onClick={toggleBookmark}>{guide.bookmarked ? '★ Bookmarked' : '☆ Bookmark'}</button>
          <button className="btn btn-soft" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>
      <h2 className="font-display text-2xl font-bold text-ink">{guide.title}</h2>
      {toc.length > 0 && (
        <div className="glass-panel p-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Contents</p>
          <ul className="text-sm text-brand-600">{toc.map((h) => <li key={h}>· {h}</li>)}</ul>
        </div>
      )}
      <div className="glass-panel note-prose p-6" dangerouslySetInnerHTML={{ __html: renderMarkdown(guide.content) }} />
    </div>
  );
}
