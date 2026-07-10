/** Small shared presentational helpers used across pages. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Kebab (⋮) options menu used consistently across the app. Shows "Edit" only
 * when `onEdit` is given (generated items are delete-only) and "Delete" when
 * `onDelete` is given. Clicks stop propagation so it can live inside a clickable
 * card without triggering the card.
 */
export function KebabMenu({ onEdit, onDelete, editLabel = 'Edit', deleteLabel = 'Delete', className = '' }) {
  const [open, setOpen] = useState(false);
  // Menu is rendered in a portal with fixed positioning anchored to the button,
  // so it's never clipped by an `overflow-hidden` ancestor (tables, cards).
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false); // fixed menu would detach on scroll
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  const toggle = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((o) => !o);
  };
  const pick = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn(); };
  return (
    <div className={`relative shrink-0 ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Options"
        aria-haspopup="menu"
        className="grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-muted transition hover:bg-white/70 hover:text-ink"
      >
        ⋮
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 60 }}
          className="glass-panel w-32 p-1.5 text-sm shadow-xl"
        >
          {onEdit && (
            <button type="button" role="menuitem" onClick={pick(onEdit)} className="menu-item"><span>✎</span> {editLabel}</button>
          )}
          {onDelete && (
            <button type="button" role="menuitem" onClick={pick(onDelete)} className="menu-item text-rose-600"><span>🗑</span> {deleteLabel}</button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Styled "Delete X? This can't be undone." confirmation. `detail` optionally
 * shows the item's name/summary in a chip.
 */
export function ConfirmModal({ title = 'Delete?', message = "This can’t be undone.", detail, confirmLabel = 'Delete', onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-muted">{message}</p>
      {detail && <p className="mt-2 rounded-lg bg-white/50 p-3 text-sm font-medium text-ink">{detail}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-soft" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

/** Centered modal dialog. Closes on backdrop click or Escape. */
export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`glass-modal animate-fade-up max-h-[90vh] w-full overflow-y-auto p-6 sm:p-7 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-xl font-bold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 grid h-8 w-8 place-items-center rounded-full text-2xl leading-none text-muted transition hover:bg-black/5 hover:text-ink"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Glassy on/off switch. */
export function Toggle({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? '' : 'bg-slate-300/70'}`}
      style={on ? { backgroundImage: 'var(--grad-teal-purple)' } : undefined}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[1.4rem]' : 'left-0.5'}`}
      />
    </button>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-purple-soft/50 border-t-brand-500" />
      <span>{label}</span>
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl border border-rose-deep/40 bg-rose-soft/15 px-4 py-3 text-sm text-rose-deep backdrop-blur">
      {message}
    </div>
  );
}

/**
 * Transient bottom-center toast. Pass a `toast` object:
 *   { msg, type?: 'success' | 'error', loading?: boolean }
 * Render `{toast && <Toast toast={toast} />}` and clear it on a timer.
 */
export function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === 'error';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        className={`glass-panel pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-semibold shadow-lg ${
          isError ? 'text-rose-600' : 'text-emerald-600'
        }`}
      >
        {toast.loading ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/40 border-t-current" />
        ) : (
          <span>{isError ? '⚠' : '✓'}</span>
        )}
        {toast.msg}
      </div>
    </div>
  );
}

/** Display metadata for the LMS provenance badge, keyed by external_source. */
const LMS_BADGES = {
  canvas: { label: 'Canvas', color: '#e2410b', text: '#c8401a' },
  blackboard: { label: 'Blackboard', color: '#262626', text: '#262626' },
  google_classroom: { label: 'Classroom', color: '#1a73e8', text: '#1558b0' },
  brightspace: { label: 'Brightspace', color: '#ff6b00', text: '#c85400' },
  moodle: { label: 'Moodle', color: '#f98012', text: '#c8650b' },
  sakai: { label: 'Sakai', color: '#1d6fb8', text: '#175a96' },
};

/** Small provenance badge for assignments synced from an LMS. */
export function LmsBadge({ source, className = '' }) {
  const b = LMS_BADGES[source] || { label: source, color: '#6366f1', text: '#4f46e5' };
  return (
    <span
      title={`Synced from ${b.label}`}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${className}`}
      style={{ backgroundColor: `${b.color}1a`, color: b.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: b.color }} /> {b.label}
    </span>
  );
}

/** Back-compat alias — older imports referenced CanvasBadge. */
export function CanvasBadge(props) {
  return <LmsBadge source="canvas" {...props} />;
}

/** Priority accents: red = High, orange = Medium, slate = Low. */
const PRIORITY_BADGES = {
  high: { label: 'High', cls: 'bg-rose-100 text-rose-600' },
  medium: { label: 'Medium', cls: 'bg-orange-100 text-orange-600' },
  low: { label: 'Low', cls: 'bg-slate-200 text-slate-600' },
};

/** Small inline badge for an assignment's priority. Renders nothing for 'none'. */
export function PriorityBadge({ priority, className = '' }) {
  const b = PRIORITY_BADGES[priority];
  if (!b) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.cls} ${className}`}
    >
      {b.label}
    </span>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="glass-panel animate-fade-up px-6 py-12 text-center">
      <p className="font-display text-lg font-bold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Color a grade percentage: soft green / amber / rose bands. */
export function gradeColor(percentage) {
  if (percentage == null) return 'text-muted';
  if (percentage >= 90) return 'text-emerald-500';
  if (percentage >= 80) return 'text-teal-500';
  if (percentage >= 70) return 'text-amber-500';
  if (percentage >= 60) return 'text-orange-400';
  return 'text-rose-400';
}

// Vivid, glowy gradient pairs — color-coded per class, cycled by index.
const GRADIENTS = [
  'linear-gradient(135deg, #ff8a4c 0%, #ff6f73 50%, #4f9fd6 100%)', // orange → coral → blue
  'linear-gradient(135deg, #ff7e79 0%, #ffc59e 100%)', // coral → peach
  'linear-gradient(135deg, #3fb8c0 0%, #ff8a6b 100%)', // teal → coral
  'linear-gradient(135deg, #5aa9d6 0%, #46c2b0 100%)', // blue → teal
  'linear-gradient(135deg, #ffb27a 0%, #ff7e9d 100%)', // amber → rose
  'linear-gradient(135deg, #7e8fe0 0%, #46c2b0 100%)', // periwinkle → teal
];

// Representative solid tones (for small calendar chips).
const PALETTE = ['#ff7a52', '#ff7e79', '#3fb8c0', '#5aa9d6', '#ff9a3d', '#7e8fe0'];

// Preset swatches offered in the class color picker.
export const CLASS_COLOR_PRESETS = [
  '#ff7a52', '#ff6f73', '#f6c453', '#5fbf77', '#3fb8c0',
  '#5aa9d6', '#7e8fe0', '#b07ad6', '#e8739c', '#8a93a6',
];

/** Lighten a #rrggbb hex toward white by `amt` (0..1). */
function lighten(hex, amt = 0.22) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// A faint neutral wash used for "Glass / Clear" classes — lets the frosted
// glass-card show through with only a subtle accent, no solid color.
export const GLASS_GRADIENT =
  'linear-gradient(135deg, rgba(150,140,170,0.38) 0%, rgba(150,140,170,0.12) 100%)';

/** True when a class has no solid color — the "Glass / Clear" look (default). */
export function isGlassColor(color) {
  return !color || ['transparent', 'clear', 'glass'].includes(String(color).toLowerCase());
}

/**
 * A class's accent gradient.
 *  - Decorative callers pass no class (`cls == null`) → vivid palette gradient,
 *    used for non-class UI (stat glows, planner/archive term accents).
 *  - A class with a hex color → a two-stop gradient derived from it.
 *  - A "Glass / Clear" class (no/​transparent color, the default) → a faint
 *    neutral so the card reads as frosted glass with just a subtle accent.
 */
export function classGradient(cls, index = 0) {
  if (cls == null) return GRADIENTS[index % GRADIENTS.length];
  if (cls.color && /^#?[0-9a-f]{6}$/i.test(cls.color)) {
    const c = cls.color.startsWith('#') ? cls.color : `#${cls.color}`;
    return `linear-gradient(135deg, ${c} 0%, ${lighten(c, 0.28)} 100%)`;
  }
  return GLASS_GRADIENT;
}

export function classColor(cls, index = 0) {
  if (isGlassColor(cls?.color)) return cls == null ? PALETTE[index % PALETTE.length] : null;
  return cls.color;
}

/**
 * Gradient for a class's small accent bar/line. A "Glass / Clear" class uses the
 * Summit brand gradient (same as the logo wordmark) rather than a flat gray, so
 * the default still feels on-brand. Colored classes use their own color.
 */
export function classAccent(cls, index = 0) {
  if (cls != null && isGlassColor(cls.color)) return 'var(--grad-teal-purple)';
  return classGradient(cls, index);
}

// Letter grade → 4.0-scale grade points (A+ capped at 4.0).
const GPA_POINTS = {
  'A+': 4.0, A: 4.0, 'A-': 3.7,
  'B+': 3.3, B: 3.0, 'B-': 2.7,
  'C+': 2.3, C: 2.0, 'C-': 1.7,
  'D+': 1.3, D: 1.0, 'D-': 0.7,
  F: 0.0,
};

export function gpaPoints(letter) {
  return letter == null ? null : (GPA_POINTS[letter] ?? null);
}

/**
 * Credit-weighted GPA across classes that have a letter grade. Classes without
 * a credits value count as 1 credit so they still contribute.
 */
export function computeGpa(classes) {
  let points = 0;
  let credits = 0;
  for (const c of classes) {
    const gp = gpaPoints(c.currentGrade?.letter);
    if (gp == null) continue;
    const w = c.credits || 1;
    points += gp * w;
    credits += w;
  }
  return credits > 0 ? Math.round((points / credits) * 100) / 100 : null;
}
