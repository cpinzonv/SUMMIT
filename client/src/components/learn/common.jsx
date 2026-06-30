/** Small shared bits for the Learn-tab content components. */

export function Labeled({ label, children }) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}

/** Upgrade prompt shown to free users on a premium tab. */
export function UpgradePanel({ feature }) {
  return (
    <div className="glass-panel flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/50 text-2xl">🔒</div>
      <h3 className="font-display text-xl font-bold text-ink">{feature} is a Pro feature</h3>
      <p className="max-w-sm text-sm text-muted">
        Flashcards are free forever. Upgrade to Summit Pro to unlock {feature.toLowerCase()},
        plus podcasts, study guides, and mind maps generated from your class material.
      </p>
      <button className="btn btn-primary" onClick={() => alert('Billing isn’t set up yet — coming soon!')}>
        Upgrade to Pro
      </button>
    </div>
  );
}

/** Friendly hint shown when a generator returns 503 (no API key) or 400 (no material). */
export function GenHint({ message }) {
  if (!message) return null;
  return <p className="text-xs text-muted">{message}</p>;
}
