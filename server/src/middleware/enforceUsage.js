/**
 * Metered-usage gates for endpoints. Run AFTER requireAuth. On block they emit a
 * 402 whose `details` carry the gate payload the client paywall reads, and log a
 * server-side 'shown' gate_event (source of truth for conversion analytics).
 *
 *   router.post('/generate', requireAuth, enforceUsage('ai_cards', { amount }), handler)
 *
 * Usage is consumed up-front (protects against abuse), but REFUNDED if the handler
 * ends up failing (5xx) — a student must not burn quota on our API being down.
 * Handlers can also reconcile the estimate to the real amount via `req.usage`
 * (see reconcileUsage) — e.g. AI cards true-up to the number actually generated.
 */
import { AppError } from '../utils/AppError.js';
import { checkAndConsume, getTierRow, effectiveTier, refundUsage, accountTypeOf } from '../services/usageGating.service.js';
import { logGateEvent } from '../services/billing.service.js';
import { limitFor, resetDateFor } from '../config/tiers.js';

const val = (v, req) => (typeof v === 'function' ? v(req) : v);

function blocked(req, next, result, message) {
  const { gate, requiredTier, tier, limit, used, account_type, institution_name, reset_date } = result;
  logGateEvent(req.user.id, { gate, action: 'shown', tierAtTime: tier, accountType: account_type }).catch(() => {});
  return next(new AppError(402, message || 'You’ve hit your free limit.', {
    // account_type routes the client to QuietNotice (institutional) vs PaywallModal (b2c).
    code: 'usage_limit', gate, requiredTier, tier, limit, used, account_type, institution_name, reset_date,
  }));
}

// Expose what was consumed (for reconciliation) and auto-refund it if the handler
// fails with a 5xx.
function armRefund(req, res, metric, result) {
  req.usage = { metric, periodKey: result.periodKey, amount: result.amount, remaining: result.remaining, tier: result.tier };
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      refundUsage(req.user.id, metric, result.periodKey, result.amount).catch(() => {});
    }
  });
}

export function enforceUsage(metric, opts = {}) {
  return async (req, res, next) => {
    try {
      const amount = val(opts.amount, req) ?? 1;
      const premiumVoice = val(opts.premiumVoice, req);
      const consume = opts.consume !== false;
      const result = await checkAndConsume(req.user.id, metric, amount, { premiumVoice, consume });
      if (!result.allowed) return blocked(req, next, result);
      if (consume) armRefund(req, res, metric, result);
      else req.usage = result;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Transcription gate. A recording MUST report its length: a missing/null
 * durationSeconds is rejected (metering 0 would slip transcription through free).
 * Enforces the per-tier per-recording cap (free: 90 min), then consumes the
 * recording's minutes against the period cap. Refunds on a 5xx failure.
 */
export function enforceTranscription() {
  return async (req, res, next) => {
    try {
      const raw = req.body?.durationSeconds;
      if (raw == null || raw === '') {
        return next(AppError.badRequest('Recording duration (durationSeconds) is required.'));
      }
      const minutes = Math.ceil((Number(raw) || 0) / 60);
      const row = await getTierRow(req.user.id);
      const tier = effectiveTier(row);
      const limitDef = limitFor(tier, 'transcription_minutes');

      if (limitDef?.maxPerRecording && minutes > limitDef.maxPerRecording) {
        return blocked(
          req, next,
          {
            gate: 'transcription', requiredTier: tier === 'free' ? 'pro' : 'max', tier,
            limit: limitDef.maxPerRecording,
            account_type: accountTypeOf(row), institution_name: row?.institution_name || null,
            reset_date: resetDateFor(limitDef.period),
          },
          `Recordings are capped at ${limitDef.maxPerRecording} minutes on your plan.`,
        );
      }

      const result = await checkAndConsume(req.user.id, 'transcription_minutes', minutes, { tierRow: row });
      if (!result.allowed) return blocked(req, next, result);
      armRefund(req, res, 'transcription_minutes', result);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
