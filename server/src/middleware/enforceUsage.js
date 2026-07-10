/**
 * Metered-usage gates for endpoints. Run AFTER requireAuth. On block they emit a
 * 402 whose `details` carry the gate payload the client paywall reads, and log a
 * server-side 'shown' gate_event (source of truth for conversion analytics).
 *
 *   router.post('/generate', requireAuth, enforceUsage('ai_cards', { amount }), handler)
 *
 * NOTE: enforceUsage consumes on the ATTEMPT. For the AI endpoints (extraction,
 * ai_cards, podcasts) that's an acceptable product stance — initiating a costly
 * generation spends the allotment. TODO: refund the counter if the generation
 * itself fails (503/no API key) — track req.usage and decrement in the handler.
 */
import { AppError } from '../utils/AppError.js';
import { checkAndConsume, getTierRow, effectiveTier } from '../services/usageGating.service.js';
import { logGateEvent } from '../services/billing.service.js';
import { limitFor } from '../config/tiers.js';

const val = (v, req) => (typeof v === 'function' ? v(req) : v);

function blocked(req, next, { gate, requiredTier, tier, limit, used }, message) {
  logGateEvent(req.user.id, { gate, action: 'shown', tierAtTime: tier }).catch(() => {});
  return next(new AppError(402, message || 'You’ve hit your free limit.', {
    code: 'usage_limit', gate, requiredTier, tier, limit, used,
  }));
}

export function enforceUsage(metric, opts = {}) {
  return async (req, res, next) => {
    try {
      const amount = val(opts.amount, req) ?? 1;
      const premiumVoice = val(opts.premiumVoice, req);
      const consume = opts.consume !== false;
      const result = await checkAndConsume(req.user.id, metric, amount, { premiumVoice, consume });
      if (!result.allowed) return blocked(req, next, result);
      req.usage = result;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Transcription gate: reads durationSeconds from the body, enforces the per-tier
 * per-recording length cap (free: 90 min), then consumes the recording's minutes
 * against the period cap (free 180/semester, pro 480/mo, max 1800/mo). Rejects
 * the recording if it would push the user over their cap.
 */
export function enforceTranscription() {
  return async (req, res, next) => {
    try {
      const minutes = Math.ceil((Number(req.body?.durationSeconds) || 0) / 60);
      if (minutes <= 0) return next(); // nothing recorded yet — nothing to meter
      const row = await getTierRow(req.user.id);
      const tier = effectiveTier(row);
      const limitDef = limitFor(tier, 'transcription_minutes');

      if (limitDef?.maxPerRecording && minutes > limitDef.maxPerRecording) {
        return blocked(
          req, next,
          { gate: 'transcription', requiredTier: tier === 'free' ? 'pro' : 'max', tier, limit: limitDef.maxPerRecording },
          `Recordings are capped at ${limitDef.maxPerRecording} minutes on your plan.`,
        );
      }

      const result = await checkAndConsume(req.user.id, 'transcription_minutes', minutes, { tierRow: row });
      if (!result.allowed) return blocked(req, next, result);
      req.usage = result;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
