import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  signTwoFactorChallenge,
  verifyTwoFactorChallenge,
} from '../utils/jwt.js';
import { verifyLoginCode } from './twofa.service.js';
import { hasPremiumAccess } from './featureGating.service.js';
import { assertInstitutionActive } from './institution.service.js';
import { issueCode, verifyCode } from './verification.service.js';

const SALT_ROUNDS = 12;

/** Shape returned to clients — never includes password_hash or LMS tokens. */
function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    school: row.school,
    timezone: row.timezone,
    preferences: row.preferences ?? {},
    // Graduation requirements — drive the Planner's climb-to-graduation goal.
    graduationCredits: row.graduation_credits ?? 120,
    semesterCredits: row.semester_credits ?? null,
    role: row.role || 'user',
    plan: row.plan || 'free',
    // Feature gating: `premium` is the computed access flag (admin/demo/is_premium/
    // active pro); the rest expose the raw subscription state for the Settings/paywall UI.
    premium: hasPremiumAccess(row),
    isPremium: Boolean(row.is_premium),
    subscriptionTier: row.subscription_tier || 'free',
    subscriptionStatus: row.subscription_status || 'none',
    twoFactorEnabled: Boolean(row.totp_enabled),
    emailVerified: Boolean(row.email_verified),
    phone: row.phone ?? null,
    phoneVerified: Boolean(row.phone_verified),
    recoveryEmail: row.recovery_email ?? null,
    recoveryEmailVerified: Boolean(row.recovery_email_verified),
    // How the account was first created, whether it can log in with a password,
    // and which social providers are linked (drives the Settings UI / future
    // account-linking). Provider tokens/ids are never exposed beyond these flags.
    authMethod: row.auth_method || 'email',
    hasPassword: Boolean(row.password_hash),
    linkedProviders: {
      google: Boolean(row.google_id),
      apple: Boolean(row.apple_id),
      github: Boolean(row.github_id),
    },
    // LMS connection status only — tokens are never exposed.
    lms: {
      connected: Boolean(row.lms_connected),
      provider: row.lms_provider ?? null,
      domain: row.lms_domain ?? null,
      syncedAt: row.lms_synced_at ?? null,
    },
    // Institution membership + whether the school's access was revoked (drives the
    // graceful-downgrade warning banner). Present only for institution members.
    institution: row.institution_id
      ? { name: row.institution_name ?? null, revoked: Boolean(row.institution_revoked_at) }
      : null,
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

/**
 * Issue a fresh access + refresh token pair for an already-authenticated user.
 * Used by the OAuth flow, where the provider (not a password) proved identity.
 */
export async function issueTokensForUser(userId) {
  return issueTokens(userId);
}

/** Signup attribution: count of users by referral_source (nulls grouped as 'unknown'). */
export async function referralSourceCounts() {
  const { rows } = await query(
    `SELECT COALESCE(referral_source, 'unknown') AS source, count(*)::int AS count
     FROM users GROUP BY COALESCE(referral_source, 'unknown') ORDER BY count DESC`,
  );
  return rows;
}

export async function register({
  email,
  password,
  fullName,
  school,
  timezone,
  referralSource,
  referralSourceDetail,
}) {
  const existing = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    throw AppError.conflict('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, school, timezone, referral_source, referral_source_detail)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'UTC'), $6, $7)
     RETURNING *`,
    [
      email,
      passwordHash,
      fullName,
      school ?? null,
      timezone ?? null,
      referralSource ?? null,
      referralSource === 'other' ? referralSourceDetail ?? null : null,
    ],
  );

  const user = rows[0];
  // New email signups start unverified — send a code and gate access until they
  // confirm it. No tokens are issued yet.
  const { devCode } = await sendSignupCode(user);
  return { verificationRequired: true, email: user.email, ...(devCode ? { devCode } : {}) };
}

/** Issue + email a signup verification code for a user. */
async function sendSignupCode(user) {
  return issueCode({
    userId: user.id,
    purpose: 'signup',
    channel: 'email',
    destination: user.email,
    subject: 'Confirm your Summit account',
    intro: 'Welcome to Summit! Your account confirmation code is',
  });
}

/** Resend the signup code (only for an existing, still-unverified account). */
export async function resendVerification({ email }) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  // Don't leak whether the email exists; only act if it's a real unverified account.
  if (!user || user.email_verified) return { sent: true };
  return sendSignupCode(user);
}

/** Confirm the signup code, mark the email verified, and log the user in. */
export async function verifyEmail({ email, code }) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) throw AppError.badRequest('That code is not valid.');
  if (user.email_verified) {
    const tokens = await issueTokens(user.id);
    return { user: toPublicUser(user), ...tokens };
  }
  await verifyCode({ userId: user.id, purpose: 'signup', code });
  await query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]);
  const fresh = (await query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0];
  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(fresh), ...tokens };
}

export async function login({ email, password }) {
  const { rows } = await query(
    `SELECT u.*, i.name AS institution_name, i.revoked_at AS institution_revoked_at
       FROM users u LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.email = $1`,
    [email],
  );
  const user = rows[0];

  // Always run a hash comparison to avoid leaking whether the email exists via
  // response timing. OAuth-only accounts have no password_hash — compare against
  // a dummy so they fall through to the same generic error (no password login).
  const ok = user?.password_hash
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinv');

  if (!user || !user.password_hash || !ok) {
    throw AppError.unauthorized('Invalid email or password');
  }

  // Hard block: a revoked institution's users cannot log in.
  await assertInstitutionActive(user);

  // Unverified email accounts must confirm their code first — re-send it and ask
  // the client to show the verification screen instead of issuing tokens.
  if (user.email_verified === false) {
    const { devCode } = await sendSignupCode(user);
    return { verificationRequired: true, email: user.email, ...(devCode ? { devCode } : {}) };
  }

  // With 2FA on, hold off on tokens — return a short-lived challenge instead.
  if (user.totp_enabled) {
    return { twoFactorRequired: true, challengeToken: signTwoFactorChallenge(user.id) };
  }

  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(user), ...tokens };
}

/** Second login step: validate the TOTP/backup code and issue tokens. */
export async function loginTwoFactor({ challengeToken, code }) {
  let payload;
  try {
    payload = verifyTwoFactorChallenge(challengeToken);
  } catch {
    throw AppError.unauthorized('Your verification session expired. Please log in again.');
  }
  const { rows } = await query(
    `SELECT u.*, i.name AS institution_name, i.revoked_at AS institution_revoked_at
       FROM users u LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = $1`,
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.totp_enabled) throw AppError.unauthorized('Invalid verification session.');

  const valid = await verifyLoginCode(user, code);
  if (!valid) throw AppError.unauthorized('Invalid authentication code.');

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

    // Hard block: refuse to refresh a revoked institution's session (so a hard
    // revoke takes effect within one access-token cycle).
    await assertInstitutionActive(record.user_id);

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

/* ---- Invite links (institution-admin onboarding) ------------------------ */

/** Validate an invite token and return the invitee's email (for the set-password page). */
export async function getInvite(token) {
  const { rows } = await query(
    `SELECT iv.expires_at, iv.used_at, u.email
       FROM user_invites iv JOIN users u ON u.id = iv.user_id
      WHERE iv.token_hash = $1`,
    [hashToken(token)],
  );
  const inv = rows[0];
  if (!inv || inv.used_at || new Date(inv.expires_at) <= new Date()) {
    throw AppError.badRequest('This invite link is invalid or has expired.');
  }
  return { email: inv.email };
}

/** Consume an invite token: set the account's password and mark it used. One-time. */
export async function acceptInvite({ token, password }) {
  const tokenHash = hashToken(token);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM user_invites WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const inv = rows[0];
    if (!inv || inv.used_at || new Date(inv.expires_at) <= new Date()) {
      throw AppError.badRequest('This invite link is invalid or has expired.');
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // Accepting an institution invite auto-verifies the email (they're vouched for).
    await client.query('UPDATE users SET password_hash = $1, email_verified = true WHERE id = $2', [passwordHash, inv.user_id]);
    await client.query('UPDATE user_invites SET used_at = now() WHERE id = $1', [inv.id]);
    return { ok: true };
  });
}

export async function getCurrentUser(userId) {
  const { rows } = await query(
    `SELECT u.*, i.name AS institution_name, i.revoked_at AS institution_revoked_at
       FROM users u LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = $1`,
    [userId],
  );
  if (!rows[0]) throw AppError.notFound('User not found');
  return toPublicUser(rows[0]);
}
