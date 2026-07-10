/**
 * Tiny bridge so the axios interceptor (non-React) can open the React paywall.
 * PaywallProvider registers a handler on mount; the response interceptor calls
 * emitPaywallGate(details) on a 402 usage_limit. No global state, no Stripe.
 */
let handler = null;

export function setPaywallHandler(fn) {
  handler = fn;
}

/** payload = the 402 error.details: { code, gate, requiredTier, tier, limit, used } */
export function emitPaywallGate(payload) {
  if (handler) handler(payload);
}
