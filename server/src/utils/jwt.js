import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/** Sign a short-lived access token carrying the user's id. */
export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  });
}

/** Verify an access token, returning its payload or throwing. */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

/**
 * Short-lived token issued after a correct password when 2FA is required. It
 * proves "password step passed" so the second step doesn't resend credentials.
 * Marked typ:'2fa' so it can't be swapped for an access token.
 */
export function signTwoFactorChallenge(userId) {
  return jwt.sign({ sub: userId, typ: '2fa' }, env.jwt.accessSecret, { expiresIn: '10m' });
}

export function verifyTwoFactorChallenge(token) {
  const payload = jwt.verify(token, env.jwt.accessSecret);
  if (payload.typ !== '2fa') throw new Error('Not a 2FA challenge token');
  return payload;
}

/**
 * Generate a refresh token. We return the raw token (sent to the client) and a
 * SHA-256 hash (stored in the DB) so a database leak does not expose usable
 * tokens. Refresh tokens are opaque random strings, not JWTs.
 */
export function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = hashToken(raw);
  const expiresAt = new Date(
    Date.now() + env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  );
  return { raw, hash, expiresAt };
}

export function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
