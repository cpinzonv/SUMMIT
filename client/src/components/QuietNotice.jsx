import { useEffect } from 'react';
import { billingApi } from '../api/billing';

/**
 * Quiet, factual usage notice for INSTITUTIONAL students (school-paid). They must
 * never see B2C sales paywalls — no founding offers, no waitlist, no pricing
 * cards, no upgrade urgency. Just: what limit, what the plan includes, when it
 * resets. A small purchase line appears ONLY in real mode for gates with an
 * add-on (transcription). Calm and minimal — no exclamation points.
 */

// gate → display label + cap formatter + whether an add-on exists.
const GATE_META = {
  transcription: { label: 'transcription', cap: (n) => `${Math.round(n / 60)} hours`, addOn: { copy: 'Add 10 hours for $5.99' } },
  podcasts: { label: 'podcasts', cap: (n) => `${n} podcasts`, addOn: null },
  premium_voice: { label: 'premium podcast voices', cap: () => 'premium voices', addOn: null },
  extraction: { label: 'syllabus extractions', cap: (n) => `${n}`, addOn: null },
  ai_cards: { label: 'AI flashcards', cap: (n) => `${n}`, addOn: null },
};

function formatReset(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export function QuietNotice({ gate, status, onClose, preview = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = GATE_META[gate?.gate] || { label: 'plan', cap: () => '', addOn: null };
  const institution = gate?.institution_name || 'your school';
  const capText = gate?.limit != null ? meta.cap(gate.limit) : '';
  const reset = formatReset(gate?.reset_date);

  // Purchase line only in REAL mode, and only for gates with an add-on.
  // TODO(contract): also require the institution's allow_student_purchases flag
  // once that contract-level setting exists (out of scope now).
  const showPurchase = Boolean(status?.paywall_enabled && status?.billing_enabled && meta.addOn);

  const buyAddOn = async () => {
    if (preview) return;
    try {
      await billingApi.checkout({ tier: 'addon', gate: gate?.gate });
    } catch {
      /* checkout is a 501 stub until real billing is wired */
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel animate-menu-pop w-full max-w-md p-7" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl font-bold text-ink">
          You’ve reached this month’s included {meta.label} limit
        </h3>
        <p className="mt-3 text-sm text-muted">
          Your <span className="font-semibold text-ink">{institution}</span> plan includes {capText ? `${capText} ` : ''}per month.
          {reset ? ` Your limit resets on ${reset}.` : ''}
        </p>

        {showPurchase && (
          <div className="mt-5 rounded-2xl border border-white/60 bg-white/40 px-4 py-3 backdrop-blur">
            <p className="text-sm text-ink">Need more before then?</p>
            <button className="btn btn-soft mt-2" onClick={buyAddOn}>{meta.addOn.copy}</button>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
