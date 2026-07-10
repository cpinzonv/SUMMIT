/**
 * Branded transactional email templates.
 *
 * These are built for EMAIL CLIENTS (Gmail, Apple Mail, Outlook), not browsers,
 * so they intentionally look "old-fashioned":
 *   - table-based layout only (no flexbox / grid / CSS positioning)
 *   - every style is inline (no <style> blocks, no external CSS)
 *   - no backdrop-filter / blur / glassmorphism (email clients strip them)
 *   - web-safe font stack, single column, <= 520px, centered
 *   - a hidden preheader + a plain-text fallback
 * Each template returns BOTH `html` and `text` so non-HTML clients render and
 * spam filters stay happy. Do NOT "modernize" these.
 */

const DEFAULT_APP_URL = 'https://learnsummit.app';

// Summit palette (email-safe hex): coral primary, teal accent, warm neutrals.
const CORAL = '#FF6584';
const TEAL = '#2DD4BF';
const FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * Signup / email verification code message. `code` is the 6-digit code; `appUrl`
 * is where the "Open Summit" button points (defaults to APP_URL, then the prod
 * URL). Returns { html, text } with {{CODE}} and {{APP_URL}} interpolated.
 */
export function verificationEmail({ code, appUrl = process.env.APP_URL || DEFAULT_APP_URL }) {
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Summit verification code</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f2ee; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <!-- Preheader: shown as the inbox preview, hidden in the body. -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#f4f2ee; opacity:0;">
    Your Summit verification code is {{CODE}} &mdash; it expires in 10 minutes.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f2ee;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px; max-width:520px; background-color:#ffffff; border-radius:16px; border:1px solid #ece8e2;">
          <!-- Gradient header (solid coral fallback for Outlook) -->
          <tr>
            <td align="center" bgcolor="${CORAL}" style="background-color:${CORAL}; background-image:linear-gradient(120deg, ${CORAL} 0%, ${TEAL} 100%); border-radius:16px 16px 0 0; padding:38px 24px;">
              <div style="font-family:${FONT}; font-size:26px; font-weight:700; letter-spacing:-0.5px; color:#ffffff;">Summit</div>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding:40px 44px 8px 44px; font-family:${FONT};">
              <h1 style="margin:0 0 12px 0; font-size:20px; line-height:28px; font-weight:700; color:#1f2430;">Your verification code</h1>
              <p style="margin:0 0 26px 0; font-size:15px; line-height:24px; color:#5b6270;">Use the code below to confirm your email and finish signing in to Summit.</p>
            </td>
          </tr>

          <!-- Code (single letter-spaced element, soft card) -->
          <tr>
            <td style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f8fa; border:1px solid #ececf1; border-radius:12px;">
                <tr>
                  <td align="center" style="padding:26px 16px;">
                    <div style="font-family:${FONT}; font-size:34px; font-weight:700; letter-spacing:10px; color:#1f2430;">{{CODE}}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:28px 44px 6px 44px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${CORAL}" style="border-radius:10px;">
                    <a href="{{APP_URL}}" target="_blank" style="display:inline-block; padding:13px 32px; font-family:${FONT}; font-size:15px; font-weight:600; line-height:20px; color:#ffffff; text-decoration:none; border-radius:10px;">Open Summit</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Expiry note -->
          <tr>
            <td align="center" style="padding:18px 44px 38px 44px; font-family:${FONT};">
              <p style="margin:0; font-size:13px; line-height:20px; color:#8a8f9c;">This code expires in 10 minutes. If you didn&rsquo;t request it, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px; max-width:520px;">
          <tr>
            <td align="center" style="padding:20px 24px 0 24px; font-family:${FONT};">
              <p style="margin:0; font-size:12px; line-height:18px; color:#a7abb5;">Summit &middot; <a href="{{APP_URL}}" target="_blank" style="color:#a7abb5; text-decoration:underline;">learnsummit.app</a></p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`
    .replaceAll('{{CODE}}', code)
    .replaceAll('{{APP_URL}}', appUrl);

  const text =
    `Your Summit code is ${code}. It expires in 10 minutes.\n\n` +
    `Open Summit: ${appUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email.`;

  return { html, text };
}
