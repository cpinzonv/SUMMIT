import { useEffect, useState } from 'react';
import { billingApi } from '../api/billing';

/**
 * Fake-door paywall modal — three modes decided by /api/billing/status:
 *   A  fake door, founding slots remain  → claim founding membership
 *   B  fake door, slots exhausted        → waitlist + locked pricing card
 *   C  real mode (paywall + billing on)  → pricing card + Upgrade (Stripe: TODO)
 * No Stripe is loaded here; Mode C's Upgrade hits a 501 stub.
 */

// gate name → the phrase that completes "You've used ___ for this semester".
const USED_PHRASE = {
  extraction: 'your 2 free syllabus extractions',
  ai_cards: 'your free AI flashcards',
  transcription: 'your free recordings',
  podcasts: 'your free podcast',
  premium_voice: 'the free podcast voices',
};

function PricingCard({ pricing, locked }) {
  if (!pricing) return null;
  return (
    <div className="rounded-2xl border border-white/60 bg-white/45 p-5 text-left backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-bold tracking-wide text-ink">{pricing.name}</span>
        {pricing.badge && (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white"
            style={{ backgroundImage: 'var(--grad-teal-purple)' }}
          >
            {pricing.badge}
          </span>
        )}
      </div>
      <div className="mt-2 text-3xl font-extrabold text-ink">{pricing.priceMonthly}</div>
      <div className="mt-1 text-sm text-muted">{pricing.priceSemester}</div>
      <ul className="mt-3 space-y-1.5 text-sm text-ink">
        {pricing.bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="text-brand-500" aria-hidden>·</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-xs text-muted">{pricing.altLine}</div>
      {locked && (
        <div className="mt-3 rounded-lg border border-white/60 bg-white/40 px-3 py-1.5 text-center text-xs font-semibold text-muted">
          Launching this January
        </div>
      )}
    </div>
  );
}

export function PaywallModal({ gate, status, onClose, onClaimed, onWaitlisted, preview = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [claimedNumber, setClaimedNumber] = useState(null);
  const [waitlisted, setWaitlisted] = useState(false);
  const [showMax, setShowMax] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!status) return null;

  const gateName = gate?.gate || 'this feature';
  const usedPhrase = USED_PHRASE[gateName] || 'your free plan';
  const realMode = status.paywall_enabled && status.billing_enabled;
  const mode = realMode ? 'C' : status.founding_slots_left > 0 ? 'A' : 'B';

  // Which pricing card: gate payload's requiredTier drives it (premium_voice /
  // count-on-pro / transcription-cap-on-pro → Max; everything else → Pro).
  const requiredTier = gate?.requiredTier || 'pro';
  const cardTier = showMax || requiredTier === 'max' ? 'max' : 'pro';
  const pricing = status.pricing?.[cardTier];

  const claim = async () => {
    if (preview) { setClaimedNumber(42); return; } // admin preview — no real claim
    setBusy(true);
    setError('');
    try {
      const res = await billingApi.claimFounding();
      if (res.slotsExhausted) {
        setError('Founding spots just filled up.');
      } else {
        setClaimedNumber(res.founding_member_number);
        onClaimed?.(res.founding_member_number);
      }
    } catch {
      setError('Could not claim your spot. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const joinWaitlist = async () => {
    if (preview) { setWaitlisted(true); return; } // admin preview — no real signup
    setBusy(true);
    setError('');
    try {
      await billingApi.joinWaitlist({ interested_tier: requiredTier, source_gate: gateName });
      setWaitlisted(true);
      onWaitlisted?.();
    } catch {
      setError('Could not add you to the waitlist. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const upgrade = async () => {
    if (preview) { setError('Checkout is launching soon.'); return; } // admin preview
    setBusy(true);
    setError('');
    try {
      await billingApi.checkout({ tier: cardTier });
    } catch {
      // Expected in this build — checkout is a 501 stub until Stripe is wired.
      setError('Checkout is launching soon.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel animate-menu-pop w-full max-w-md p-7"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Success states */}
        {claimedNumber != null ? (
          <div className="text-center">
            <h3 className="font-display text-2xl font-bold text-ink">You’re in.</h3>
            <p className="mt-2 text-lg font-semibold text-gradient">You’re Founding Member #{claimedNumber}</p>
            <p className="mt-2 text-sm text-muted">Summit Pro is on us for a full year. Enjoy.</p>
            <button className="btn btn-primary mt-6" onClick={onClose}>Keep going</button>
          </div>
        ) : waitlisted ? (
          <div className="text-center">
            <h3 className="font-display text-2xl font-bold text-ink">You’re on the list</h3>
            <p className="mt-2 text-sm text-muted">We’ll email you at launch.</p>
            <button className="btn btn-primary mt-6" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {mode === 'C' ? (
              <>
                <h3 className="font-display text-xl font-bold text-ink">Your whole semester, handled.</h3>
                <p className="mt-2 text-sm text-muted">
                  Unlimited extractions, flashcards, and recording hours — one payment covers you through the end of the term.
                </p>
              </>
            ) : (
              <h3 className="font-display text-xl font-bold text-ink">
                You’ve used {usedPhrase} for this semester
              </h3>
            )}

            {mode === 'A' && (
              <>
                <p className="mt-2 text-sm text-muted">
                  Founding members get a full year of Summit Pro — free.{' '}
                  <span className="font-semibold text-ink">
                    {status.founding_slots_left} of {status.founding_cap} spots left.
                  </span>
                </p>
                <div className="mt-6 flex flex-col items-center gap-3">
                  <button className="btn btn-primary w-full" onClick={claim} disabled={busy}>
                    {busy ? 'Claiming…' : 'Claim Founding Member Access'}
                  </button>
                  <button className="text-sm font-semibold text-muted hover:text-ink" onClick={onClose}>
                    Maybe later
                  </button>
                </div>
              </>
            )}

            {mode === 'B' && (
              <>
                <p className="mt-2 text-sm text-muted">Summit Pro launches this January.</p>
                <p className="mt-2 text-sm text-ink">
                  Keep using everything free until January — Pro just adds unlimited.
                </p>
                <div className="mt-4">
                  <PricingCard pricing={pricing} locked />
                </div>
                <div className="mt-5 flex flex-col items-center gap-3">
                  <button className="btn btn-primary w-full" onClick={joinWaitlist} disabled={busy}>
                    {busy ? 'Saving…' : 'Save my spot for January'}
                  </button>
                  <button className="text-sm font-semibold text-muted hover:text-ink" onClick={onClose}>
                    Maybe later
                  </button>
                </div>
              </>
            )}

            {mode === 'C' && (
              <>
                <div className="mt-4">
                  <PricingCard pricing={pricing} />
                </div>
                <div className="mt-5 flex flex-col items-center gap-3">
                  <button className="btn btn-primary w-full" onClick={upgrade} disabled={busy}>
                    {busy ? 'Opening…' : 'Get Summit Pro'}
                  </button>
                  <button className="text-sm font-semibold text-muted hover:text-ink" onClick={onClose}>
                    Maybe later
                  </button>
                </div>
              </>
            )}

            {/* Pro-card gates can peek at Max. */}
            {requiredTier === 'pro' && (
              <button
                className="mt-4 block w-full text-center text-xs font-semibold text-brand-600 hover:underline"
                onClick={() => setShowMax((v) => !v)}
              >
                {showMax ? 'Back to Pro' : 'Need more? See Max'}
              </button>
            )}

            {error && <p className="mt-3 text-center text-sm text-rose-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
