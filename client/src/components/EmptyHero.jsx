/**
 * Shared glassmorphism empty-state hero (frosted card, floating illustration,
 * headline, subheading, coral CTA) used by the Planner and Notes empty states.
 * Built on the app's existing glass-panel + btn classes and the animate-fade-up
 * / animate-float utilities (no separate CSS file).
 */

export function EmptyHero({ illustration, headline, subheading, ctaLabel, onCta, secondaryLabel, onSecondary }) {
  return (
    <div className="flex justify-center px-4 py-8">
      <div className="glass-panel animate-fade-up flex max-w-lg flex-col items-center p-8 text-center sm:p-12">
        <div className="animate-float flex h-40 w-40 items-center justify-center">{illustration}</div>
        <h2 className="mt-4 font-display text-2xl font-bold text-ink">{headline}</h2>
        <p className="mt-2 max-w-sm text-sm text-muted">{subheading}</p>
        {(ctaLabel || secondaryLabel) && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {ctaLabel && (
              <button className="btn btn-primary" onClick={onCta}>{ctaLabel}</button>
            )}
            {secondaryLabel && (
              <button className="btn btn-soft" onClick={onSecondary}>{secondaryLabel}</button>
            )}
          </div>
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

/** Document with a checklist + a checkmark badge (Assignments). */
export function AssignmentsIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('asgn')}
      <ellipse cx="100" cy="172" rx="52" ry="9" fill="#4FC3DC" opacity="0.12" />
      {/* document */}
      <g filter="url(#asgn-glow)" transform="rotate(-5 100 100)">
        <rect x="56" y="38" width="88" height="118" rx="10" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        <rect x="56" y="38" width="88" height="22" rx="10" fill="url(#asgn-grad)" opacity="0.9" />
        {/* checklist rows: small box + line */}
        {[0, 1, 2].map((i) => {
          const y = 78 + i * 22;
          const done = i === 0;
          return (
            <g key={i}>
              <rect x="68" y={y} width="12" height="12" rx="3" fill={done ? '#4FC3DC' : 'none'} stroke="#4FC3DC" strokeWidth="2" />
              {done && <path d={`M70.5 ${y + 6} l2.5 2.5 l4.5 -5`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
              <line x1="88" y1={y + 6} x2={i === 2 ? 116 : 130} y2={y + 6} stroke="rgba(27,76,92,0.2)" strokeWidth="3" strokeLinecap="round" />
            </g>
          );
        })}
      </g>
      {/* floating checkmark badge */}
      <g transform="translate(132 120)">
        <circle r="20" fill="url(#asgn-grad)" filter="url(#asgn-glow)" />
        <path d="M-8 1 l5 5 l10 -11" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
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

/** Clock face with a gradient ring + tick marks (Schedule / meeting times). */
export function ScheduleIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('sched')}
      <ellipse cx="100" cy="172" rx="52" ry="9" fill="#4FC3DC" opacity="0.12" />
      {/* clock face */}
      <g filter="url(#sched-glow)">
        <circle cx="100" cy="96" r="58" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        <circle cx="100" cy="96" r="58" fill="none" stroke="url(#sched-grad)" strokeWidth="6" opacity="0.9" />
        {/* tick marks at 12 / 3 / 6 / 9 */}
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1="100"
            y1="48"
            x2="100"
            y2="56"
            stroke="rgba(27,76,92,0.35)"
            strokeWidth="3"
            strokeLinecap="round"
            transform={`rotate(${deg} 100 96)`}
          />
        ))}
        {/* hands: coral hour (up) + teal minute (to ~4 o'clock) */}
        <line x1="100" y1="96" x2="100" y2="64" stroke="#FF6B4A" strokeWidth="5" strokeLinecap="round" />
        <line x1="100" y1="96" x2="126" y2="110" stroke="#4FC3DC" strokeWidth="5" strokeLinecap="round" />
        <circle cx="100" cy="96" r="5.5" fill="#1B4C5C" />
      </g>
    </svg>
  );
}

/** Quiz card: multiple-choice option pills + a floating "?" badge (Quizzes). */
export function QuizIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('quiz')}
      <ellipse cx="100" cy="172" rx="54" ry="9" fill="#4FC3DC" opacity="0.12" />
      {/* card */}
      <g filter="url(#quiz-glow)" transform="rotate(-4 100 100)">
        <rect x="50" y="40" width="100" height="118" rx="12" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        <rect x="50" y="40" width="100" height="24" rx="12" fill="url(#quiz-grad)" opacity="0.9" />
        <line x1="62" y1="52" x2="104" y2="52" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
        {/* option pills: bubble + line; the 2nd is selected */}
        {[0, 1, 2].map((i) => {
          const y = 82 + i * 22;
          const sel = i === 1;
          return (
            <g key={i}>
              <rect x="62" y={y - 7} width="76" height="16" rx="8" fill={sel ? 'rgba(79,195,220,0.16)' : 'rgba(27,76,92,0.05)'} />
              <circle cx="72" cy={y + 1} r="6" fill={sel ? '#4FC3DC' : 'none'} stroke={sel ? '#4FC3DC' : 'rgba(27,76,92,0.3)'} strokeWidth="2" />
              {sel && <path d={`M69 ${y + 1} l2.2 2.2 l4 -4.6`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
              <line x1="86" y1={y + 1} x2={i === 2 ? 118 : 130} y2={y + 1} stroke="rgba(27,76,92,0.2)" strokeWidth="3" strokeLinecap="round" />
            </g>
          );
        })}
      </g>
      {/* floating "?" badge */}
      <g transform="translate(138 116)">
        <circle r="21" fill="url(#quiz-grad)" filter="url(#quiz-glow)" />
        <text x="0" y="7" textAnchor="middle" fontFamily="ui-rounded, 'Segoe UI', sans-serif" fontSize="26" fontWeight="800" fill="#fff">?</text>
      </g>
    </svg>
  );
}

/** Studio microphone with sound waves (Podcasts). */
export function PodcastIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('pod')}
      <ellipse cx="100" cy="174" rx="46" ry="9" fill="#FF6B4A" opacity="0.12" />
      {/* sound waves */}
      {[26, 40].map((r, i) => (
        <g key={r} opacity={i === 0 ? 0.55 : 0.28}>
          <path d={`M${100 - r} ${86 - r * 0.7} a${r} ${r} 0 0 0 0 ${r * 1.4}`} fill="none" stroke="#4FC3DC" strokeWidth="5" strokeLinecap="round" />
          <path d={`M${100 + r} ${86 - r * 0.7} a${r} ${r} 0 0 1 0 ${r * 1.4}`} fill="none" stroke="#FF6B4A" strokeWidth="5" strokeLinecap="round" />
        </g>
      ))}
      {/* mic capsule */}
      <g filter="url(#pod-glow)">
        <rect x="84" y="46" width="32" height="60" rx="16" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        <rect x="84" y="46" width="32" height="60" rx="16" fill="url(#pod-grad)" opacity="0.9" />
        {/* grille lines */}
        {[58, 68, 78, 88].map((y) => (
          <line key={y} x1="92" y1={y} x2="108" y2={y} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
        ))}
      </g>
      {/* yoke + stand */}
      <path d="M74 92 a26 26 0 0 0 52 0" fill="none" stroke="#1B4C5C" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      <line x1="100" y1="118" x2="100" y2="140" stroke="#1B4C5C" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      <line x1="84" y1="140" x2="116" y2="140" stroke="#1B4C5C" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

/** Open book with a bookmark ribbon (Study guides). */
export function GuideIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('guide')}
      <ellipse cx="100" cy="170" rx="58" ry="9" fill="#4FC3DC" opacity="0.12" />
      <g filter="url(#guide-glow)">
        {/* left + right pages */}
        <path d="M100 56 C84 46 64 46 46 52 L46 140 C64 134 84 134 100 144 Z" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        <path d="M100 56 C116 46 136 46 154 52 L154 140 C136 134 116 134 100 144 Z" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        {/* spine */}
        <rect x="97" y="54" width="6" height="90" rx="3" fill="url(#guide-grad)" />
        {/* text lines */}
        {[74, 88, 102, 116].map((y, i) => (
          <g key={y}>
            <line x1="56" y1={y} x2={i === 3 ? 78 : 90} y2={y} stroke="rgba(27,76,92,0.18)" strokeWidth="3" strokeLinecap="round" />
            <line x1="110" y1={y} x2={i === 3 ? 132 : 144} y2={y} stroke="rgba(27,76,92,0.18)" strokeWidth="3" strokeLinecap="round" />
          </g>
        ))}
      </g>
      {/* bookmark ribbon */}
      <path d="M128 48 L128 92 L138 82 L148 92 L148 48 Z" fill="url(#guide-grad)" filter="url(#guide-glow)" />
    </svg>
  );
}

/** Bar chart climbing up with a trend arrow (Stats / progress). */
export function StatsIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" aria-hidden="true">
      {defs('stats')}
      <ellipse cx="100" cy="172" rx="56" ry="9" fill="#4FC3DC" opacity="0.12" />
      {/* panel */}
      <g filter="url(#stats-glow)">
        <rect x="42" y="44" width="116" height="112" rx="14" fill="#fff" stroke="rgba(27,76,92,0.12)" />
        {/* bars, increasing */}
        {[{ x: 60, h: 30 }, { x: 84, h: 48 }, { x: 108, h: 66 }, { x: 132, h: 84 }].map((b, i) => (
          <rect key={i} x={b.x} y={140 - b.h} width="14" height={b.h} rx="4"
            fill={i === 3 ? 'url(#stats-grad)' : 'rgba(79,195,220,0.28)'} />
        ))}
        {/* baseline */}
        <line x1="54" y1="140" x2="146" y2="140" stroke="rgba(27,76,92,0.15)" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      {/* trend arrow */}
      <g filter="url(#stats-glow)">
        <path d="M60 116 L86 96 L108 106 L138 74" fill="none" stroke="#FF6B4A" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M126 72 L140 70 L138 84" fill="none" stroke="#FF6B4A" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
