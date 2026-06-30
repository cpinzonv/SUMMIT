import { useEffect, useState } from 'react';

/**
 * Make a fixed-position window draggable by a handle element. Returns the
 * current {x,y} (top-left). Dragging is clamped to the viewport, and drags that
 * start on an interactive element (input/button/editor) are ignored so the
 * controls in the header still work.
 *
 * @param {{ windowRef: React.RefObject, handleRef: React.RefObject, initial: {x,y} }} opts
 */
export function useDraggable({ windowRef, handleRef, initial }) {
  const [pos, setPos] = useState(initial);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return undefined;

    const onDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, textarea, a, [contenteditable]')) return;
      e.preventDefault();
      const rect = windowRef.current.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      const ox = rect.left;
      const oy = rect.top;
      const w = rect.width;
      const h = rect.height;

      const onMove = (m) => {
        const nx = Math.min(Math.max(8, ox + (m.clientX - sx)), window.innerWidth - w - 8);
        const ny = Math.min(Math.max(8, oy + (m.clientY - sy)), window.innerHeight - h - 8);
        setPos({ x: nx, y: ny });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', onDown);
    return () => handle.removeEventListener('mousedown', onDown);
  }, [windowRef, handleRef]);

  return pos;
}
