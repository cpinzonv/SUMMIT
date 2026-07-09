/**
 * Rate limiting (express-rate-limit). Three tiers, all keyed by client IP:
 *   • apiLimiter       — a generous global ceiling to blunt scraping / abuse.
 *   • authLimiter      — moderate, for account-creation / code-resend endpoints.
 *   • sensitiveLimiter — strict (5/min), for credential + reset + 2FA endpoints
 *                        to throttle brute-force and code-guessing.
 *
 * Requires `app.set('trust proxy', 1)` (set in app.js) so req.ip is the real
 * client behind Railway's proxy rather than the proxy's address. Responses use
 * the app's standard { error: { message } } shape with HTTP 429.
 */
import rateLimit from 'express-rate-limit';

const json429 = (message) => (req, res) => {
  res.status(429).json({ error: { message } });
};

const base = {
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false,
};

// Global ceiling — high enough never to bother a real user, low enough to blunt
// automated abuse. 600 requests / 15 min per IP.
export const apiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 600,
  handler: json429('Too many requests — please slow down and try again shortly.'),
});

// Account creation, email verification, code resends. 20 / 10 min per IP.
export const authLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  max: 20,
  handler: json429('Too many attempts — please wait a few minutes and try again.'),
});

// Credential checks, password reset, and 2FA — brute-force surface. 5 / min per IP.
export const sensitiveLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 5,
  handler: json429('Too many attempts — wait a minute before trying again.'),
});
