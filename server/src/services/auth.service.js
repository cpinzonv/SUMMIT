import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
} from '../utils/jwt.js';

const SALT_ROUNDS = 12;

/** Shape returned to clients — never includes password_hash. */
function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    school: row.school,
    timezone: row.timezone,
    preferences: row.preferences ?? {},
    createdAt: row.created_at,
  };
}

/** Change a user's password after verifying the current one (bcrypt). */
export async function changePassword(userId, currentPassword, newPassword) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw AppError.notFound('User not found');

  const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!ok) throw AppError.badRequest('Current password is incorrect');

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

async function issueTokens(userId) {
  const accessToken = signAccessToken(userId);
  const { raw, hash, expiresAt } = generateRefreshToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt],
  );
  return { accessToken, refreshToken: raw };
}

export async function register({ email, password, fullName, school, timezone }) {
  const existing = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    throw AppError.conflict('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, school, timezone)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'UTC'))
     RETURNING *`,
    [email, passwordHash, fullName, school ?? null, timezone ?? null],
  );

  const user = rows[0];
  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(user), ...tokens };
}

export async function login({ email, password }) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  // Always run a hash comparison to avoid leaking whether the email exists via
  // response timing.
  const ok = user
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinv');

  if (!user || !ok) {
    throw AppError.unauthorized('Invalid email or password');
  }

  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(user), ...tokens };
}

/** Rotate a refresh token: revoke the presented one and issue a fresh pair. */
export async function refresh({ refreshToken }) {
  const tokenHash = hashToken(refreshToken);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const record = rows[0];

    if (
      !record ||
      record.revoked_at !== null ||
      new Date(record.expires_at) <= new Date()
    ) {
      throw AppError.unauthorized('Invalid or expired refresh token');
    }

    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
      [record.id],
    );

    const accessToken = signAccessToken(record.user_id);
    const { raw, hash, expiresAt } = generateRefreshToken();
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [record.user_id, hash, expiresAt],
    );

    return { accessToken, refreshToken: raw };
  });
}

/** Revoke a refresh token (logout). Idempotent. */
export async function logout({ refreshToken }) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(refreshToken)],
  );
}

export async function getCurrentUser(userId) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw AppError.notFound('User not found');
  return toPublicUser(rows[0]);
}
