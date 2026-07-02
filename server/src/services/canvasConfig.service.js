/**
 * Admin-managed Canvas configuration (singleton row in canvas_config).
 *
 * STUB: the running server still reads Canvas client id/secret + the token
 * encryption key from ENV at boot (config/env.js). This service persists what an
 * admin enters so it survives restarts and can later be wired to be honored at
 * runtime. Secrets are stored ENCRYPTED and never returned to the client.
 *
 * The token encryption key is WRITE-ONCE: replacing it would make every existing
 * encrypted LMS token + 2FA secret undecryptable, so once set it cannot be
 * overwritten through this path (generate-if-absent only).
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { encrypt } from '../utils/crypto.js';

const HEX_64 = /^[0-9a-fA-F]{64}$/;

/** Raw singleton row (encrypted secrets included) or null. Internal use. */
async function getRow() {
  const { rows } = await query('SELECT * FROM canvas_config WHERE id = 1');
  return rows[0] ?? null;
}

/**
 * Client-safe view — never exposes the stored secret or encryption key, only
 * whether they are present.
 */
export async function getPublicConfig() {
  const row = await getRow();
  const instanceUrl = row?.instance_url ?? '';
  const clientId = row?.oauth_client_id ?? '';
  const hasClientSecret = Boolean(row?.oauth_client_secret);
  const hasEncryptionKey = Boolean(row?.token_encryption_key);
  return {
    instanceUrl,
    clientId,
    hasClientSecret,
    hasEncryptionKey,
    configured: Boolean(instanceUrl && clientId && hasClientSecret && hasEncryptionKey),
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Upsert the config. Fields are all optional so a save can update just some of
 * them:
 *   - instanceUrl / clientId: set as given (trimmed).
 *   - clientSecret: updated only when a non-empty value is supplied (so the admin
 *     doesn't have to re-enter it every save); stored encrypted.
 *   - encryptionKey: accepted ONLY if none is stored yet (write-once). Must be
 *     64 hex chars. Attempting to overwrite an existing key is rejected.
 */
export async function saveConfig({ instanceUrl, clientId, clientSecret, encryptionKey } = {}) {
  const existing = await getRow();

  if (encryptionKey) {
    if (existing?.token_encryption_key) {
      throw AppError.badRequest(
        'A token encryption key is already set and cannot be overwritten — replacing it would make all existing encrypted tokens and 2FA secrets unreadable.',
      );
    }
    if (!HEX_64.test(encryptionKey)) {
      throw AppError.badRequest('Token encryption key must be 64 hexadecimal characters.');
    }
  }

  const nextInstanceUrl = instanceUrl != null ? instanceUrl.trim() : existing?.instance_url ?? null;
  const nextClientId = clientId != null ? clientId.trim() : existing?.oauth_client_id ?? null;
  const nextSecret =
    clientSecret && clientSecret.trim()
      ? encrypt(clientSecret.trim())
      : existing?.oauth_client_secret ?? null;
  const nextKey = encryptionKey
    ? encrypt(encryptionKey)
    : existing?.token_encryption_key ?? null;

  await query(
    `INSERT INTO canvas_config (id, instance_url, oauth_client_id, oauth_client_secret, token_encryption_key, updated_at)
     VALUES (1, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       instance_url = EXCLUDED.instance_url,
       oauth_client_id = EXCLUDED.oauth_client_id,
       oauth_client_secret = EXCLUDED.oauth_client_secret,
       token_encryption_key = EXCLUDED.token_encryption_key,
       updated_at = now()`,
    [nextInstanceUrl, nextClientId, nextSecret, nextKey],
  );

  return getPublicConfig();
}
