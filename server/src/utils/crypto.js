/**
 * Symmetric encryption for sensitive values we must store but want to keep
 * unreadable at rest — currently LMS OAuth tokens.
 *
 * AES-256-GCM with a random 12-byte IV per value. The stored payload is
 *   v1:<base64(iv | authTag | ciphertext)>
 * so the scheme/version is self-describing and we can rotate later.
 *
 * The key comes from LMS_TOKEN_ENC_KEY (64 hex chars = 32 bytes). If it isn't
 * configured the LMS feature is treated as unavailable (503), mirroring the
 * optional ANTHROPIC_API_KEY pattern — we never fall back to plaintext.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'v1:';

/** True when a usable encryption key is configured. */
export function isEncryptionConfigured() {
  return /^[0-9a-fA-F]{64}$/.test(env.lms.tokenEncKey || '');
}

function getKey() {
  if (!isEncryptionConfigured()) {
    throw new AppError(
      503,
      'LMS integration is not configured. Set LMS_TOKEN_ENC_KEY (64 hex chars) in the server environment.',
    );
  }
  return Buffer.from(env.lms.tokenEncKey, 'hex');
}

/** Encrypt a UTF-8 string, returning the self-describing payload. */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a payload produced by encrypt(). Returns null for empty input. */
export function decrypt(payload) {
  if (!payload) return null;
  const key = getKey();
  if (!payload.startsWith(PREFIX)) {
    throw new AppError(500, 'Stored token has an unrecognized encryption format.');
  }
  const raw = Buffer.from(payload.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
