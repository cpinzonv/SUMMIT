/**
 * Which gate UI to show for a 402 payload. Institutional (school-paid) students
 * get the calm QuietNotice; everyone else gets the B2C PaywallModal (modes A/B/C).
 * Institutional users must NEVER see A/B/C under any flag combination — the only
 * thing that decides this is account_type, not paywall/billing flags.
 */
export function gateView(payload) {
  return payload?.account_type === 'institutional' ? 'quiet' : 'paywall';
}
