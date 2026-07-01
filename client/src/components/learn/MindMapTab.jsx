import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Spinner, ErrorBanner } from '../ui';
import { EmptyHero, SparkleIllustration } from '../EmptyHero';
import { exportSvg } from '../../lib/learnExport';

/** Mind maps: list, generate (premium), and view as a pan/zoomable SVG graph. */
export function MindMapTab({ classId, flash }) {
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/learn/classes/${classId}/mindmaps`);
      setMaps(data.mindmaps);
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
      const { data } = await api.post(`/api/learn/classes/${classId}/mindmaps/generate`, {});
      flash('Mind map generated');
      setActiveId(data.mindmapId);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (activeId) return <MindMapViewer mindmapId={activeId} onExit={() => setActiveId(null)} />;
  if (loading) return <Spinner label="Loading mind maps…" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn btn-soft" disabled={busy} onClick={generate}>{busy ? 'Generating…' : '✦ Generate mind map'}</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {maps.length === 0 ? (
        <EmptyHero
          illustration={<SparkleIllustration />}
          headline="No mind maps yet"
          subheading="Generate a visual concept map from this class's notes and transcripts."
          ctaLabel="✦ Generate mind map"
          onCta={generate}
        />
      ) : (
        <div className="space-y-2">
          {maps.map((m) => (
            <button key={m.id} onClick={() => setActiveId(m.id)} className="glass-panel flex w-full items-center justify-between p-4 text-left transition hover:shadow-md">
              <div>
                <p className="font-semibold text-ink">{m.centralTopic || m.title}</p>
                <p className="text-xs text-muted">{m.nodeCount} nodes · {new Date(m.generatedAt).toLocaleDateString()}</p>
              </div>
              <span className="text-sm font-semibold text-brand-600">View →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const W = 900;
const H = 640;

/** Radial layout: central node in the middle, level-1 around it, level-2 near parents. */
function layout(nodes) {
  const pos = {};
  const cx = W / 2;
  const cy = H / 2;
  const central = nodes.find((n) => n.level === 0) || nodes[0];
  if (central) pos[central.id] = { x: cx, y: cy, angle: 0 };

  const level1 = nodes.filter((n) => n.level === 1);
  level1.forEach((n, i) => {
    const angle = (i / Math.max(1, level1.length)) * Math.PI * 2 - Math.PI / 2;
    pos[n.id] = { x: cx + 230 * Math.cos(angle), y: cy + 230 * Math.sin(angle), angle };
  });

  const level2 = nodes.filter((n) => n.level === 2);
  const byParent = {};
  for (const n of level2) (byParent[n.parentId] ??= []).push(n);
  for (const [parentId, kids] of Object.entries(byParent)) {
    const base = pos[parentId]?.angle ?? 0;
    kids.forEach((n, i) => {
      const spread = (i - (kids.length - 1) / 2) * 0.5;
      const a = base + spread;
      const p = pos[parentId] || { x: cx, y: cy };
      pos[n.id] = { x: p.x + 150 * Math.cos(a), y: p.y + 150 * Math.sin(a), angle: a };
    });
  }
  return pos;
}

function MindMapViewer({ mindmapId, onExit }) {
  const [map, setMap] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    (async () => {
      try { const { data } = await api.get(`/api/learn/mindmaps/${mindmapId}`); setMap(data); }
      catch (e) { setError(errorMessage(e)); }
    })();
  }, [mindmapId]);

  const pos = useMemo(() => (map ? layout(map.nodes) : {}), [map]);

  const onDown = (e) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; };
  const onMove = (e) => {
    if (!drag.current) return;
    setView((v) => ({ ...v, x: drag.current.ox + (e.clientX - drag.current.sx), y: drag.current.oy + (e.clientY - drag.current.sy) }));
  };
  const onUp = () => { drag.current = null; };
  const zoom = (d) => setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(2.5, v.scale + d)) }));

  if (error) return <div className="space-y-3"><ErrorBanner message={error} /><button className="btn btn-soft" onClick={onExit}>← Back</button></div>;
  if (!map) return <Spinner label="Loading mind map…" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button className="text-sm text-muted hover:text-ink" onClick={onExit}>← Back to mind maps</button>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink">{map.centralTopic || map.title}</span>
          <button className="btn btn-soft !px-2 !py-1" onClick={() => zoom(-0.2)} aria-label="Zoom out">−</button>
          <button className="btn btn-soft !px-2 !py-1" onClick={() => zoom(0.2)} aria-label="Zoom in">+</button>
          <button className="btn btn-soft !px-2 !py-1" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>Reset</button>
          <button className="btn btn-soft !px-2 !py-1" onClick={() => exportSvg(svgRef.current, (map.centralTopic || map.title || 'mindmap').replace(/[^a-z0-9]+/gi, '_').toLowerCase(), 'png')}>⬇ PNG</button>
        </div>
      </div>
      <div className="glass-panel overflow-hidden p-0">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`} style={{ transformOrigin: 'center' }}>
            {map.edges.map((e, i) => {
              const a = pos[e.fromId]; const b = pos[e.toId];
              if (!a || !b) return null;
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(100,116,139,0.35)" strokeWidth={1.5} />;
            })}
            {map.nodes.map((n) => {
              const p = pos[n.id];
              if (!p) return null;
              const label = (n.label || '').slice(0, 26);
              const w = Math.max(60, label.length * 7 + 20);
              const h = n.level === 0 ? 40 : 30;
              return (
                <g key={n.id}>
                  <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={h / 2}
                    fill={n.color} opacity={n.level === 0 ? 1 : 0.9} />
                  <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                    fontSize={n.level === 0 ? 14 : 11} fontWeight={n.level === 0 ? 700 : 600} fill="#fff">
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="text-center text-xs text-muted">Drag to pan · use +/− to zoom</p>
    </div>
  );
}
