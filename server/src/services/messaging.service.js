/**
 * Transactional messaging — email (Resend) + SMS (Twilio). When a provider key
 * isn't configured, we DON'T fail: the message is logged server-side so the flow
 * still works end-to-end, and callers surface the code in dev (see verification
 * service). Real delivery turns on the moment the provider env vars are set.
 */
import { env } from '../config/env.js';

export const emailConfigured = () => Boolean(env.resendApiKey);
export const smsConfigured = () => Boolean(env.twilioSid && env.twilioToken && env.twilioFrom);

/** Send an email via Resend, or log it if unconfigured. Never throws to callers. */
export async function sendEmail({ to, subject, text, html }) {
  if (!emailConfigured()) {
    console.log(`[dev email] to=${to} · ${subject}\n${text || ''}`);
    return { delivered: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.emailFrom, to, subject, html: html || `<p>${text}</p>`, text }),
    });
    if (!res.ok) {
      console.error(`[email] Resend ${res.status}: ${await res.text().catch(() => '')}`);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error('[email] send failed:', err?.message);
    return { delivered: false };
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
