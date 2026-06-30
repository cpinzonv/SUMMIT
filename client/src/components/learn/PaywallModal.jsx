import { useEffect } from 'react';

/**
 * Paywall modal shown when a free user clicks a locked premium tab (or on a 403
 * from a premium endpoint). When billing isn't live yet the CTA is a friendly
 * "coming soon"; once enabled it becomes a real upgrade action (Stripe — future).
 */
const PERKS = [
  'All learning formats — quizzes, podcasts, study guides & mind maps',
  'Google Calendar sync',
  'Advanced learning analytics',
];

export function PaywallModal({ feature, billingEnabled = false, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel animate-menu-pop w-full max-w-md p-7 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
          <svg width="28" height="28" viewBox="0 0 24 24" className="text-[#FF6B4A]" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
        <h3 className="mt-4 font-display text-2xl font-bold text-ink">Upgrade to <span className="text-gradient">Pro</span></h3>
        <p className="mt-1 text-sm text-muted">{feature} is available on Summit Pro.</p>

        <ul className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-ink">
          {PERKS.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <span className="mt-0.5 font-bold text-emerald-500">✓</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {billingEnabled ? (
            <button className="btn btn-primary" onClick={() => alert('Subscription checkout is coming soon.')}>Upgrade to Pro</button>
          ) : (
            <span className="btn btn-primary pointer-events-none opacity-80">Pro plans launching soon</span>
          )}
          <button className="btn btn-soft" onClick={onClose}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}
