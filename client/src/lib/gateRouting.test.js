import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateView } from './gateRouting.js';

// Institutional 402s must render QuietNotice — NEVER PaywallModal modes A/B/C —
// under any combination of paywall/billing flags. gateView is the single choke
// point the PaywallProvider branches on, so testing it here proves the routing.

test('institutional 402 always routes to QuietNotice', () => {
  assert.equal(gateView({ account_type: 'institutional', gate: 'transcription' }), 'quiet');
  assert.equal(gateView({ account_type: 'institutional', gate: 'podcasts' }), 'quiet');
});

test('institutional routing ignores paywall/billing flags (all combos → quiet)', () => {
  // The 402 payload never carries flags, but assert the decision depends ONLY on
  // account_type: extra fields must not flip it to the B2C paywall.
  for (const paywall_enabled of [true, false]) {
    for (const billing_enabled of [true, false]) {
      assert.equal(
        gateView({ account_type: 'institutional', paywall_enabled, billing_enabled }),
        'quiet',
        `institutional must stay quiet with paywall=${paywall_enabled} billing=${billing_enabled}`,
      );
    }
  }
});

test('b2c 402 routes to the PaywallModal', () => {
  assert.equal(gateView({ account_type: 'b2c', gate: 'ai_cards' }), 'paywall');
});

test('missing / unknown account_type defaults to the B2C paywall', () => {
  assert.equal(gateView({ gate: 'ai_cards' }), 'paywall');
  assert.equal(gateView(null), 'paywall');
  assert.equal(gateView(undefined), 'paywall');
});
