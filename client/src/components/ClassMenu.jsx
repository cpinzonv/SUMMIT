import { useEffect, useRef, useState } from 'react';
import { LinkLmsModal } from './LinkLmsModal';
import { lmsLabel, lmsAccent } from '../lib/lms';

/**
 * Small pill showing which LMS a class is linked to (e.g. "Canvas"). Renders
 * nothing when the class isn't linked. `lms` is the provider key.
 */
export function LmsBadge({ lms, className = '' }) {
  if (!lms) return null;
  const accent = lmsAccent(lms);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-ink backdrop-blur ${className}`}
      title={`Linked to ${lmsLabel(lms)}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
      {lmsLabel(lms)}
    </span>
  );
}

/**
 * A "3-dot" actions menu for a class card/row. Lives inside a wrapping <Link>,
 * so every handler stops propagation + prevents the card's navigation. Currently
 * offers "Link to LMS" (opens the glass LinkLmsModal); onUpdated(updatedClass)
 * fires after a successful link so the parent list can refresh its badge.
 */
export function ClassMenu({ cls, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Keep clicks on the menu from triggering the surrounding card link.
  const swallow = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} className="relative" onClick={swallow}>
      <button
        type="button"
        aria-label="Class actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          swallow(e);
          setOpen((v) => !v);
        }}
        className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-black/5 hover:text-ink"
      >
        {/* vertical ellipsis */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="glass-modal animate-fade-up absolute right-0 top-9 z-30 w-44 overflow-hidden p-1.5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              swallow(e);
              setOpen(false);
              setModal(true);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink transition hover:bg-black/5"
          >
            {/* link icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            {cls.linkedLms ? 'Change LMS link' : 'Link to LMS'}
          </button>
        </div>
      )}

      {modal && (
        <LinkLmsModal
          cls={cls}
          onClose={() => setModal(false)}
          onLinked={(updated) => {
            setModal(false);
            onUpdated?.(updated);
          }}
        />
      )}
    </div>
  );
}
