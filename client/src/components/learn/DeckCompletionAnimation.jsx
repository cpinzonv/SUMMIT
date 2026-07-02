/**
 * Celebratory end-of-study overlay. Replaces the old 🎉 emoji with an animated
 * glassmorphic card: a gradient "summit peak" badge that pops + glows, a few
 * subtle particles floating up, and the two next-step CTAs. Animations live in
 * index.css (summitGlow / floatUp / deckPop / deckFadeIn) and respect
 * prefers-reduced-motion.
 */

// Coral → orange → teal, per the completion spec.
const PEAK_GRADIENT = 'linear-gradient(135deg, #FF6B35 0%, #FF8C42 55%, #3fb8c0 100%)';

// A handful of accent particles (position %, size px, delay s, tint).
const PARTICLES = [
  { left: 18, size: 8, delay: 0, color: '#FF6B35' },
  { left: 34, size: 5, delay: 0.5, color: '#FF8C42' },
  { left: 50, size: 10, delay: 0.2, color: '#3fb8c0' },
  { left: 64, size: 6, delay: 0.8, color: '#FF8C42' },
  { left: 80, size: 7, delay: 0.35, color: '#FF6B35' },
  { left: 90, size: 4, delay: 1.1, color: '#3fb8c0' },
];

function SummitPeak() {
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" aria-hidden="true">
      <path d="M4 38 L18 12 L27 30 L33 20 L44 38 Z" fill="#ffffff" />
      {/* snow cap highlight on the tall peak */}
      <path d="M18 12 L22 20 L14 20 Z" fill="#FFE9DF" />
    </svg>
  );
}

export default function DeckCompletionAnimation({ count = 0, summary = null, note = null, onReviewAgain, onBackToDecks }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="deck-complete-card glass-panel relative w-full max-w-[400px] overflow-hidden p-8 text-center">
        {/* particles */}
        <div className="pointer-events-none absolute inset-x-0 bottom-16 top-24" aria-hidden="true">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="deck-particle absolute bottom-0 rounded-full"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                opacity: 0.6,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}
        </div>

        {/* animated summit badge: glow ring behind, popping gradient circle in front */}
        <div className="relative mx-auto h-24 w-24">
          <span className="deck-complete-glow absolute inset-0 rounded-full" />
          <span
            className="deck-complete-icon absolute inset-0 grid place-items-center rounded-full"
            style={{ backgroundImage: PEAK_GRADIENT }}
          >
            <SummitPeak />
          </span>
        </div>

        <h2 className="deck-complete-text mt-5 font-display text-2xl font-bold text-ink">Deck complete!</h2>
        <p className="deck-complete-text mt-1 text-sm text-muted">
          You&rsquo;ve studied {count} card{count === 1 ? '' : 's'} today
        </p>

        {summary && summary.length > 0 && (
          <div className="deck-complete-text mt-4 flex justify-center gap-5">
            {summary.map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-display text-lg font-bold text-ink">{s.value}</div>
                <div className="text-[11px] font-medium text-muted">{s.label}</div>
              </div>
            ))}
          </div>
        )}
        {note && <p className="deck-complete-text mt-3 text-xs font-medium text-brand-600">{note}</p>}

        <div className="deck-complete-text mt-6 flex gap-2">
          <button onClick={onReviewAgain} className="btn btn-soft flex-1">Review again</button>
          <button onClick={onBackToDecks} className="btn btn-primary flex-1">Back to decks</button>
        </div>
      </div>
    </div>
  );
}
