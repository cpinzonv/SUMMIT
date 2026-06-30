/** Small shared bits for the Learn-tab content components. */

export function Labeled({ label, children }) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}

/**
 * Paywall shown to free users on a premium tab. When billing isn't enabled yet
 * the CTA is a friendly "coming soon"; once billingEnabled flips on it becomes a
 * real subscribe action (Stripe checkout — future).
 */
export function UpgradePanel({ feature, billingEnabled = false }) {
  return (
    <div className="glass-panel animate-fade-up mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
        <svg width="26" height="26" viewBox="0 0 24 24" className="text-brand-600" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <h3 className="font-display text-xl font-bold text-ink">{feature} is a <span className="text-gradient">Pro</span> feature</h3>
      <p className="max-w-sm text-sm text-muted">
        Flashcards are free forever. Summit Pro unlocks {feature.toLowerCase()}, plus podcasts,
        study guides, and mind maps generated from your class material.
      </p>
      {billingEnabled ? (
        <button className="btn btn-primary" onClick={() => alert('Subscription checkout is coming soon.')}>
          Upgrade to Pro
        </button>
      ) : (
        <span className="rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-muted">
          Pro plans launching soon
        </span>
      )}
    </div>
  );
}

/** Friendly hint shown when a generator returns 503 (no API key) or 400 (no material). */
export function GenHint({ message }) {
  if (!message) return null;
  return <p className="text-xs text-muted">{message}</p>;
}
