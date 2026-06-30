/**
 * Shared glassmorphism empty-state hero (frosted card, floating illustration,
 * headline, subheading, coral CTA) used by the Planner and Notes empty states.
 * Built on the app's existing glass-panel + btn classes and the animate-fade-up
 * / animate-float utilities (no separate CSS file).
 */

export function EmptyHero({ illustration, headline, subheading, ctaLabel, onCta }) {
  return (
    <div className="flex justify-center px-4 py-8">
      <div className="glass-panel animate-fade-up flex max-w-lg flex-col items-center p-8 text-center sm:p-12">
        <div className="animate-float flex h-40 w-40 items-center justify-center">{illustration}</div>
        <h2 className="mt-4 font-display text-2xl font-bold text-ink">{headline}</h2>
        <p className="mt-2 max-w-sm text-sm text-muted">{subheading}</p>
        {ctaLabel && (
          <button className="btn btn-primary mt-6" onClick={onCta}>{ctaLabel}</button>
        )}
      </div>
    </div>
  );
}

/* ---- illustrations -------------------------------------------------------- */

const defs = (id) => (
  <defs>
    <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#FF6B4A" />
      <stop offset="100%" stopColor="#4FC3DC" />
    </linearGradient>
    <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3" result="b" />
      <feMerge>
        <feMergeNode in="b" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
);

/** Calendar grid with a few colored course chips (Planner). */
export function CalendarIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('cal')}
      <ellipse cx="100" cy="172" rx="56" ry="9" fill="#FF6B4A" opacity="0.12" />
      {/* calendar body */}
      <g filter="url(#cal-glow)">
        <rect x="42" y="38" width="116" height="122" rx="14" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        <rect x="42" y="38" width="116" height="28" rx="14" fill="url(#cal-grad)" />
        <rect x="42" y="58" width="116" height="8" fill="url(#cal-grad)" opacity="0.9" />
        {/* binder rings */}
        <rect x="64" y="30" width="6" height="18" rx="3" fill="#1B4C5C" />
        <rect x="130" y="30" width="6" height="18" rx="3" fill="#1B4C5C" />
      </g>
      {/* day grid */}
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3].map((c) => {
          const x = 56 + c * 24;
          const y = 78 + r * 20;
          const chip = (r === 1 && c === 0) || (r === 2 && c === 2) || (r === 0 && c === 3);
          const colors = ['#FF6B4A', '#4FC3DC', '#FFB4A2'];
          const ci = (r + c) % 3;
          return (
            <rect key={`${r}-${c}`} x={x} y={y} width="14" height="12" rx="3"
              fill={chip ? colors[ci] : 'rgba(27,76,92,0.10)'} />
          );
        }),
      )}
    </svg>
  );
}

/** Notepad with ruled lines + a pencil (Notes). */
export function NotepadIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('note')}
      <ellipse cx="100" cy="172" rx="52" ry="9" fill="#4FC3DC" opacity="0.12" />
      {/* paper */}
      <g filter="url(#note-glow)" transform="rotate(-6 100 100)">
        <rect x="54" y="40" width="92" height="120" rx="10" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        <rect x="54" y="40" width="92" height="22" rx="10" fill="url(#note-grad)" opacity="0.9" />
        <line x1="66" y1="78" x2="134" y2="78" stroke="rgba(27,76,92,0.22)" strokeWidth="3" strokeLinecap="round" />
        <line x1="66" y1="92" x2="134" y2="92" stroke="rgba(27,76,92,0.16)" strokeWidth="3" strokeLinecap="round" />
        <line x1="66" y1="106" x2="120" y2="106" stroke="rgba(27,76,92,0.16)" strokeWidth="3" strokeLinecap="round" />
        <line x1="66" y1="120" x2="128" y2="120" stroke="rgba(27,76,92,0.16)" strokeWidth="3" strokeLinecap="round" />
      </g>
      {/* pencil */}
      <g transform="rotate(40 140 120)">
        <rect x="132" y="78" width="14" height="74" rx="3" fill="#FFB4A2" />
        <rect x="132" y="78" width="14" height="10" fill="#4FC3DC" />
        <path d="M132 152 L139 166 L146 152 Z" fill="#1B4C5C" />
        <path d="M137 158 L139 162 L141 158 Z" fill="#fff" />
      </g>
    </svg>
  );
}
