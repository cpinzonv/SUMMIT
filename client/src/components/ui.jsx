/** Small shared presentational helpers used across pages. */
import { useEffect } from 'react';

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
        className={`glass-panel max-h-[90vh] w-full overflow-y-auto p-6 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-2xl leading-none text-muted transition hover:text-ink"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
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

export function EmptyState({ title, children }) {
  return (
    <div className="rounded-2xl border border-dashed border-purple-soft/50 bg-white/40 px-6 py-12 text-center backdrop-blur">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
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

// Vivid, sophisticated gradient pairs — color-coded per class, cycled by index.
const GRADIENTS = [
  'linear-gradient(135deg, #3fa1a6 0%, #8b7fd0 100%)', // teal → slate blue
  'linear-gradient(135deg, #ef9078 0%, #f6c9a0 100%)', // coral → peach
  'linear-gradient(135deg, #e87f9a 0%, #9b8fd0 100%)', // rose → periwinkle
  'linear-gradient(135deg, #6f9fe0 0%, #4bb0a8 100%)', // blue → teal
  'linear-gradient(135deg, #f6b98f 0%, #e58aa0 100%)', // peach → rose
  'linear-gradient(135deg, #9b8fd0 0%, #4bb0a8 100%)', // periwinkle → teal
];

// Representative solid tones (for small calendar chips).
const PALETTE = ['#3fa1a6', '#e8857e', '#8b7ba8', '#6f9fe0', '#ef9078', '#9b8fd0'];

export function classGradient(cls, index = 0) {
  return GRADIENTS[index % GRADIENTS.length];
}

export function classColor(cls, index = 0) {
  return cls?.color || PALETTE[index % PALETTE.length];
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
