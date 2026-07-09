import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';

const COLORS = ['#1f2937', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
const CANVAS_W = 760;
const CANVAS_H = 440;

/**
 * A simple in-app handwriting/drawing pad (mouse, touch, or stylus). Pen +
 * eraser + color + stroke width. On save, exports the drawing as a PNG data URL
 * via `onSave(dataUrl)` — the caller inserts it into the note.
 */
export function HandwritingCanvas({ onSave, onClose }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [color, setColor] = useState(COLORS[0]);
  const [erasing, setErasing] = useState(false);
  const [size, setSize] = useState(3);
  const [dirty, setDirty] = useState(false);

  // White background so the exported PNG isn't transparent.
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }, []);

  const posOf = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return {
      x: (p.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (p.clientY - rect.top) * (CANVAS_H / rect.height),
    };
  };

  const start = (e) => {
    drawing.current = true;
    last.current = posOf(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = posOf(e);
    ctx.strokeStyle = erasing ? '#ffffff' : color;
    ctx.lineWidth = erasing ? size * 6 : size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!dirty) setDirty(true);
  };
  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    setDirty(false);
  };

  const save = () => onSave(canvasRef.current.toDataURL('image/png'));

  const swatchBtn = 'h-7 w-7 rounded-full border-2 transition';

  return (
    <Modal title="Handwritten note" onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {/* Colors */}
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => { setColor(c); setErasing(false); }}
              className={`${swatchBtn} ${!erasing && color === c ? 'border-ink scale-110' : 'border-white/70'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        {/* Pen / eraser */}
        <div className="flex items-center gap-1 rounded-full bg-white/50 p-1">
          <button type="button" onClick={() => setErasing(false)} className={`rounded-full px-3 py-1 text-sm font-semibold ${!erasing ? 'bg-white text-brand-700 shadow-sm' : 'text-muted'}`}>✏️ Pen</button>
          <button type="button" onClick={() => setErasing(true)} className={`rounded-full px-3 py-1 text-sm font-semibold ${erasing ? 'bg-white text-brand-700 shadow-sm' : 'text-muted'}`}>🧽 Eraser</button>
        </div>
        {/* Stroke width */}
        <label className="flex items-center gap-2 text-xs text-muted">
          Size
          <input type="range" min={1} max={10} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-20 accent-brand-500" />
        </label>
        <button type="button" onClick={clear} className="ml-auto text-sm font-semibold text-muted hover:text-rose-500">Clear</button>
      </div>

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
        className="w-full touch-none rounded-xl border border-white/60 shadow-inner"
        style={{ background: '#fff', aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
      />

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-soft" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!dirty} onClick={save}>Insert into note</button>
      </div>
    </Modal>
  );
}
