/**
 * Server-wide LMS admin credentials (Canvas for now): validate + encrypt + store
 * in lms_credentials, and hand back a ready-to-use CanvasClient at call time.
 *
 * The base URL and API key are stored together as one AES-256-GCM blob
 * (utils/crypto, keyed by APP_ENCRYPTION_KEY); the key is only decrypted when we
 * actually build a client to talk to Canvas.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { encrypt, decrypt, isEncryptionConfigured } from '../utils/crypto.js';
import { CanvasClient, normalizeBaseUrl } from '../integrations/canvas.js';

// Only Canvas is supported for now (Blackboard/others come later).
const SUPPORTED = new Set(['canvas']);

/**
 * Save (or replace) the admin Canvas config. Validates the URL + key, encrypts
 * { baseUrl, apiKey }, and upserts the single row for that LMS. Never returns
 * the secret.
 */
export async function configureLms(userId, { lms, canvasBaseUrl, canvasApiKey }) {
  if (!SUPPORTED.has(lms)) {
    throw AppError.badRequest(`Unsupported LMS "${lms}". Only Canvas is available right now.`);
  }
  if (!isEncryptionConfigured()) {
    throw new AppError(503, 'Encryption is not configured. Set APP_ENCRYPTION_KEY (64 hex chars) on the server.');
  }

  const baseUrl = normalizeBaseUrl(canvasBaseUrl); // throws 400 on bad URL
  const apiKey = String(canvasApiKey || '').trim();
  if (!apiKey) throw AppError.badRequest('The Canvas API key is required.');

  const encrypted = encrypt(JSON.stringify({ baseUrl, apiKey }));

  const { rows } = await query(
    `INSERT INTO lms_credentials (lms, encrypted_data, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (lms) DO UPDATE
       SET encrypted_data = EXCLUDED.encrypted_data,
           created_by     = EXCLUDED.created_by
     RETURNING id, lms, created_at, updated_at`,
    [lms, encrypted, userId],
  );

  // Audit log — never log the key or base URL secrets beyond the host.
  console.info(`[lms] ${lms} credentials configured by user ${userId} (host ${new URL(baseUrl).host})`);
  return { ok: true, lms, configuredAt: rows[0].updated_at };
}

/** Whether an LMS has server credentials configured. */
export async function isLmsConfigured(lms) {
  const { rowCount } = await query('SELECT 1 FROM lms_credentials WHERE lms = $1', [lms]);
  return rowCount > 0;
}

/** Decrypt the stored Canvas config → { baseUrl, apiKey }. Throws if unset. */
function loadCanvasConfig() {
  return query('SELECT encrypted_data FROM lms_credentials WHERE lms = $1', ['canvas']).then(({ rows }) => {
    if (!rows[0]) {
      throw AppError.badRequest(
        'Canvas is not configured on this server yet. An admin needs to add the Canvas base URL and API key in Settings.',
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(decrypt(rows[0].encrypted_data));
    } catch {
      throw new AppError(500, 'Stored Canvas credentials could not be read.');
    }
    return parsed; // { baseUrl, apiKey }
  });
}

/** Build a CanvasClient from the stored admin credentials (decrypts at call time). */
export async function getCanvasClient() {
  const { baseUrl, apiKey } = await loadCanvasConfig();
  return new CanvasClient({ baseUrl, apiKey });
}
