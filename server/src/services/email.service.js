/**
 * Transactional email via SMTP (Nodemailer).
 *
 * OPTIONAL feature, mirroring the ANTHROPIC_API_KEY / LMS pattern: when SMTP is
 * not configured we DON'T fail — we log the message (and, for password resets,
 * the reset link) to the server console so the flow is fully testable in dev
 * without a mail provider. In production, set SMTP_HOST/PORT/USER/PASS.
 *
 * The transporter is created lazily and cached so we don't hold a pool open when
 * email is unused.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let cachedTransport = null;

/** True when enough SMTP config is present to actually send mail. */
export function isEmailConfigured() {
  return Boolean(env.email.host && env.email.user && env.email.pass);
}

function getTransport() {
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.secure,
    auth: { user: env.email.user, pass: env.email.pass },
  });
  return cachedTransport;
}

/**
 * Send an email. Returns { sent: boolean }. When SMTP is unconfigured we log a
 * preview to the console and return { sent: false } — callers treat that as a
 * soft success (the user-facing response never reveals delivery state anyway).
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    console.info(
      `[email] SMTP not configured — would send to ${to}: "${subject}"` +
        (text ? `\n${text}` : ''),
    );
    return { sent: false };
  }
  await getTransport().sendMail({ from: env.email.from, to, subject, html, text });
  return { sent: true };
}

/**
 * Build the password-reset email (HTML + plaintext fallback). `resetUrl` is the
 * full link containing the raw token; `name` personalizes the greeting.
 */
export function passwordResetEmail({ name, resetUrl, expiresHours = 24 }) {
  const greetingName = name ? name.split(' ')[0] : 'there';
  const subject = 'Reset your Summit password';

  const text = [
    `Hi ${greetingName},`,
    '',
    'We received a request to reset the password for your Summit account.',
    `Reset it here (this link expires in ${expiresHours} hours):`,
    resetUrl,
    '',
    "If you didn't request this, you can safely ignore this email — your",
    'password will stay the same.',
    '',
    '— The Summit team',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,0.08);">
            <tr>
              <td style="background:linear-gradient(135deg,#14b8a6,#8b5cf6);padding:28px 32px;">
                <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Summit</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0f172a;">Reset your password</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
                  Hi ${greetingName}, we received a request to reset the password for your Summit account. Tap the button below to choose a new one.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
                  <tr>
                    <td style="border-radius:12px;background:linear-gradient(135deg,#14b8a6,#8b5cf6);">
                      <a href="${resetUrl}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#64748b;">
                  This link expires in <strong>${expiresHours} hours</strong>. If the button doesn't work, copy and paste this URL into your browser:
                </p>
                <p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;color:#8b5cf6;">
                  ${resetUrl}
                </p>
                <div style="border-top:1px solid #e2e8f0;padding-top:16px;">
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
                    🔒 If you didn't request a password reset, you can safely ignore this email — your password won't change. Never share this link with anyone; the Summit team will never ask you for it.
                  </p>
                </div>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">Summit · Reach your summit, one semester at a time</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
