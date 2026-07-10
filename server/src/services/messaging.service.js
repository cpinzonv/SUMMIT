/**
 * Transactional messaging — email (Resend) + SMS (Twilio). When a provider key
 * isn't configured, we DON'T fail: the message is logged server-side so the flow
 * still works end-to-end, and callers surface the code in dev (see verification
 * service). Real delivery turns on the moment the provider env vars are set.
 */
import { env } from '../config/env.js';

export const emailConfigured = () => Boolean(env.resendApiKey);
export const smsConfigured = () => Boolean(env.twilioSid && env.twilioToken && env.twilioFrom);

/**
 * Send an email via Resend. Never throws to callers — returns
 * { delivered, id?, status?, error? } so the caller can decide what to do on
 * failure. Logs the recipient + the from-address actually used on every attempt,
 * plus the Resend message id (success) or the full error (failure). NEVER logs
 * the message body/verification code or the API key.
 *
 * NB: this uses the Resend REST API via fetch (not the SDK). The REST API signals
 * an API-level rejection with a non-2xx status + an error body, so we check
 * `res.ok` explicitly and treat any non-2xx as a hard failure — a configured send
 * is never reported as delivered unless Resend actually accepted it.
 */
export async function sendEmail({ to, subject, text, html }) {
  const from = env.emailFrom;
  if (!emailConfigured()) {
    // Unconfigured: never call Resend. The code is surfaced via the API response
    // (issueCode's devCode) outside production — we deliberately do NOT log it.
    console.warn(`[email] RESEND_API_KEY unset — skipped send of "${subject}" to=${to} from=${from}`);
    return { delivered: false, reason: 'unconfigured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html: html || `<p>${text}</p>`, text }),
    });
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      // e.g. 403 on an unverified/sandbox sending domain. Surface the real cause.
      console.error(`[email] Resend send FAILED — status=${res.status} to=${to} from=${from} body=${raw}`);
      return { delivered: false, status: res.status, error: raw };
    }
    let id;
    try { id = JSON.parse(raw)?.id; } catch { /* success body may be empty/non-JSON */ }
    console.log(`[email] sent — to=${to} from=${from} id=${id ?? 'unknown'}`);
    return { delivered: true, id };
  } catch (err) {
    console.error(`[email] send ERROR — to=${to} from=${from} name=${err?.name} message=${err?.message}`);
    return { delivered: false, error: err?.message };
  }
}

/** Send an SMS via Twilio, or log it if unconfigured. Never throws to callers. */
export async function sendSms({ to, body }) {
  if (!smsConfigured()) {
    console.log(`[dev sms] to=${to}\n${body}`);
    return { delivered: false };
  }
  try {
    const auth = Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: env.twilioFrom, Body: body }),
    });
    if (!res.ok) {
      console.error(`[sms] Twilio ${res.status}: ${await res.text().catch(() => '')}`);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error('[sms] send failed:', err?.message);
    return { delivered: false };
  }
}
