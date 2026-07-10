# Billing activation runbook

How to turn Summit's **fake-door paywall** into **real billing** when we're legally
cleared (target: January 2027). Today everything is fake-door: gates work, founding
members + waitlist collect, analytics log — but **nothing charges** and **no payment
SDK is loaded**. Two switches keep it dormant: the `BILLING_ENABLED` env var (master
kill switch) and the admin **Paywall mode** toggle (`feature_flags.paywall_enabled`).

> Do the steps in order. Nothing here should be started until Section 1 is fully
> confirmed by legal.

---

## 1. Prerequisites (confirm before writing any payment code)

- [ ] **Legal entity confirmed** — which company owns the payment relationship.
- [ ] **Business bank account open** under that entity (for payouts).
- [ ] **Payment processor decision confirmed.** Stripe is the assumed default, but
      it is **pending lawyer guidance on Panama payout constraints** — Stripe may not
      support payouts to the chosen entity/bank, in which case we use an alternative
      (Paddle / Lemon Squeezy as merchant-of-record, or a local processor). **If the
      processor is NOT Stripe, Sections 2 and 4 change** — the concepts (create
      products, take a payment, receive a webhook, set `users.tier`/`pro_until`) are
      the same, but the SDK/API calls differ. Do not write processor-specific code
      until this is locked.

---

## 2. Stripe dashboard setup (assuming Stripe is confirmed)

1. Create the Stripe account **under the confirmed legal entity** (Section 1).
2. **Connect the business bank account** (Settings → Payouts). Complete identity /
   business verification.
3. Create **Products + Prices**. Semester plans are **one-time** payments (no
   auto-renewal). Monthly plans are **recurring subscriptions**.

   | Plan | Price | Type | Stripe price mode |
   |------|-------|------|-------------------|
   | Pro — monthly    | **$8.99 / month**      | recurring   | `recurring` (interval: month) |
   | Pro — semester   | **$24.99 one-time**    | one-time    | `one_time` |
   | Max — monthly    | **$17.99 / month**     | recurring   | `recurring` (interval: month) |
   | Max — semester   | **$49.99 one-time**    | one-time    | `one_time` |

4. **Record the resulting price IDs here** (fill in at setup time):

   ```
   PRO_MONTHLY_PRICE_ID    = price_________________
   PRO_SEMESTER_PRICE_ID   = price_________________
   MAX_MONTHLY_PRICE_ID    = price_________________
   MAX_SEMESTER_PRICE_ID   = price_________________
   ```

> NOTE — the display copy is intentional and consistent with these charges, no
> change needed. The fake-door pricing in `server/src/config/tiers.js` (`PRICING`)
> leads with **$5.55/mo** (Pro) / **$11.11/mo** (Max): this is a *per-month framing
> of the semester price* ($24.99 / $49.99 spread across the ~4.5-month term), shown
> with "billed once — $24.99 for the full semester" underneath and the true recurring
> monthly ($8.99 / $17.99) as the "cancel anytime" alternative line. So **$5.55 is
> not a separate price** — it's how the one-time $24.99 semester charge is presented.
> Create the Stripe prices at the actual charge amounts in the table above.

---

## 3. Railway env vars (add in the Railway dashboard — never commit)

- `STRIPE_SECRET_KEY` — the account's secret key (`sk_live_...`; use `sk_test_...` while testing).
- `STRIPE_WEBHOOK_SECRET` — the signing secret for the webhook endpoint (`whsec_...`).
- (Do NOT flip `BILLING_ENABLED` yet — that's the final step, Section 5.)

Same rule as `RESEND_API_KEY` / `APP_ENCRYPTION_KEY`: added directly in Railway by
the repo owner, never in the repo. Do not paste secrets into chat or code.

---

## 4. Code to build at activation (exact TODO locations)

The stub already 501s in the right place. Wire these:

1. **Checkout session** — `server/src/controllers/billing.controller.js` →
   `checkout()`, at the `// TODO(stripe):` marker (~line 58). Replace the 501 with:
   create a Stripe Checkout Session for `req.body.tier` + billing period using the
   price IDs from Section 2, and return `{ url }`. The client already calls this:
   `client/src/components/PaywallModal.jsx` → `upgrade()` (~line 118) — change it to
   redirect to the returned `url` instead of treating the response as an error.

2. **Webhook handler** — NEW route. Stripe webhooks need the **raw** request body,
   so mount it BEFORE `express.json()` in `server/src/app.js` (e.g.
   `POST /api/billing/webhook` with `express.raw({ type: 'application/json' })`),
   verify the signature with `STRIPE_WEBHOOK_SECRET`, then handle:
   - `checkout.session.completed` → set `users.tier` and `users.pro_until`:
     - **semester (one-time):** `tier = purchased tier`, `pro_until = end of the
       current academic term` — **Dec 31** if purchased Jul–Dec, **May 31** if
       purchased Jan–Jun (matches the S2/S1 semester boundaries in
       `tiers.js` `periodKeyFor`). No auto-renewal.
     - **monthly (subscription):** `tier = purchased tier`; `pro_until` is driven by
       the subscription status (set to the current period end; keep it current on
       renewals).
   - `customer.subscription.deleted` / `...updated` (cancellation) → downgrade:
     `tier = 'free'` once the paid period ends.
   - `invoice.payment_failed` → after retries, downgrade `tier = 'free'` (or a grace
     window) and optionally notify the user.

   The effective-tier resolver (`usageGating.effectiveTier`) already falls back to
   `users.tier` when `pro_until` has passed, so gates re-enable automatically at
   expiry — no extra downgrade job needed for the `pro_until` path.

3. **Gate event** — log `action: 'upgraded'` (already an allowed `gate_events`
   action) from the webhook so the admin gate-analytics reflects real conversions.

4. Store the Stripe `customer` id + `subscription` id on the user (add columns) so
   cancellations/updates can be matched back to a user.

---

## 5. Activation sequence

1. **Test mode end-to-end**: with `sk_test_...`, run a full purchase for each plan;
   confirm the webhook sets `tier`/`pro_until` correctly and gates unlock.
2. Set **`BILLING_ENABLED=true`** in Railway (redeploy). The admin banner's
   kill-switch warning disappears.
3. Flip the admin **Paywall mode** toggle ON (Admin → Monetization). Confirm modal
   → real mode. Modal now shows Mode C (Upgrade → Stripe Checkout).
4. **One real $0.50 test purchase** (a temporary $0.50 price or Stripe's smallest
   live charge) end-to-end; then refund it. Verify payout lands in the bank account.
5. **Email the waitlist** (export from Admin → Monetization → Export CSV) announcing
   launch.

---

## 6. Rollback

Flipping the admin **Paywall mode** toggle **OFF** instantly returns every gate to
fake-door mode (claim founding / waitlist) with **no redeploy** — the modal mode is
read live from `/api/billing/status` each time a gate opens. For a harder stop, set
`BILLING_ENABLED=false` in Railway (blocks the checkout endpoint entirely).
Neither touches existing users' `tier`/`pro_until`, so nobody loses access on
rollback.
