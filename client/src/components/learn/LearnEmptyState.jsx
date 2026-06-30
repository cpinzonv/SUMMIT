/**
 * Beautiful, on-brand empty state for a class with no flashcards yet.
 * Glassmorphism card + a floating "flashcard with sparkles" illustration +
 * two CTAs (generate / add by hand). Replaces the generic dashed EmptyState.
 */

function CardSparklesIllustration() {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="animate-float h-40 w-40" aria-hidden="true">
      <defs>
        <linearGradient id="es-card" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF6B4A" />
          <stop offset="100%" stopColor="#4FC3DC" />
        </linearGradient>
        <filter id="es-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* soft glow puddle behind the card */}
      <ellipse cx="100" cy="165" rx="46" ry="9" fill="#FF6B4A" opacity="0.12" />

      {/* floating flashcard, gently tilted */}
      <g transform="translate(100 98) rotate(-12)">
        <rect x="-42" y="-56" width="84" height="112" rx="12" fill="url(#es-card)" filter="url(#es-glow)" />
        <rect x="-42" y="-56" width="84" height="34" rx="12" fill="white" opacity="0.22" />
        <line x1="-30" y1="-28" x2="30" y2="-28" stroke="white" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
        <line x1="-30" y1="-12" x2="30" y2="-12" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.32" />
        <line x1="-30" y1="3" x2="18" y2="3" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.32" />
      </g>

      {/* sparkles */}
      <g strokeLinecap="round">
        <g stroke="#FFB4A2" fill="#FFB4A2">
          <circle cx="48" cy="44" r="2.5" />
          <line x1="48" y1="36" x2="48" y2="52" strokeWidth="2" />
          <line x1="40" y1="44" x2="56" y2="44" strokeWidth="2" />
        </g>
        <g stroke="#4FC3DC" fill="#4FC3DC">
          <circle cx="156" cy="58" r="2" />
          <line x1="156" y1="52" x2="156" y2="64" strokeWidth="1.5" />
          <line x1="150" y1="58" x2="162" y2="58" strokeWidth="1.5" />
        </g>
        <g stroke="#FF6B4A" fill="#FF6B4A">
          <circle cx="150" cy="150" r="1.8" />
          <line x1="150" y1="145" x2="150" y2="155" strokeWidth="1.5" />
          <line x1="145" y1="150" x2="155" y2="150" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  );
}

export function LearnEmptyState({ className, onGenerate, onAddManual }) {
  return (
    <div className="flex justify-center px-4 py-8">
      <div className="glass-panel animate-fade-up flex max-w-lg flex-col items-center p-8 text-center sm:p-12">
        <CardSparklesIllustration />
        <h2 className="mt-4 font-display text-2xl font-bold text-ink">
          Ready to ace <span className="text-gradient">{className || 'this class'}</span>?
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted">
          Generate flashcards from your notes &amp; transcripts, or create one by hand.
        </p>
        <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3">
          <button className="btn btn-primary" onClick={onGenerate}>Generate from notes</button>
          <button
            className="rounded-[0.95rem] border-2 border-[#4FC3DC] bg-[#4FC3DC]/10 px-5 py-[0.55rem] text-sm font-semibold text-[#2a93ab] transition hover:-translate-y-0.5 hover:bg-[#4FC3DC]/20"
            onClick={onAddManual}
          >
            Add card manually
          </button>
        </div>
      </div>
    </div>
  );
}
