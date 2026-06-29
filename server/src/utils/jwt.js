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
