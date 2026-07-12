import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  signTwoFactorChallenge,
  verifyTwoFactorChallenge,
  signRestoreChallenge,
} from '../utils/jwt.js';
import { verifyLoginCode } from './twofa.service.js';
import { hasPremiumAccess } from './featureGating.service.js';
import { assertInstitutionActive } from './institution.service.js';
import { issueCode, verifyCode } from './verification.service.js';
import { assignFoundingOnSignup } from './billing.service.js';
import { consumeInviteCode } from './registration.service.js';
import { isDeviceTrusted, trustDevice, revokeAllTrustedDevices } from './trustedDevice.service.js';
import { sendEmail } from './messaging.service.js';
import { logSecurityEvent } from './audit.service.js';

const SALT_ROUNDS = 12;
// Max concurrent active refresh tokens (sessions) per user; the oldest is
// revoked when a new login would exceed it.
const MAX_ACTIVE_SESSIONS = 5;

/** Shape returned to clients — never includes password_hash or LMS tokens. */
export function toPublicUser(row) {
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
    // Soft-delete state: true while the account is in its 30-day recovery window.
    // Drives the Restore screen; a normal (active) session never sees this true.
    pendingDeletion: Boolean(row.deleted_at),
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
  // A password change logs out every device: revoke all refresh tokens, drop
  // remembered 2FA devices, and invalidate outstanding access tokens (M1) so no
  // session lingers on the old credential.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  await revokeAllTrustedDevices(userId);
  await query('UPDATE users SET sessions_invalidated_at = now() WHERE id = $1', [userId]);
}

/**
 * Revoke the caller's oldest active refresh tokens beyond MAX_ACTIVE_SESSIONS,
 * so a user can hold at most N concurrent sessions. Runs inside the caller's
 * transaction/client.
 */
async function enforceSessionCap(client, userId) {
  const { rows } = await client.query(
    `SELECT id FROM refresh_tokens
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      OFFSET $2`,
    [userId, MAX_ACTIVE_SESSIONS],
  );
  if (rows.length) {
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
  }
}

async function issueTokens(userId, { userAgent = null, ip = null } = {}) {
  const accessToken = signAccessToken(userId);
  const { raw, hash, expiresAt } = generateRefreshToken();
  await withTransaction(async (client) => {
    // A fresh login starts a NEW rotation family (gen_random_uuid()).
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id, user_agent, ip)
       VALUES ($1, $2, $3, gen_random_uuid(), $4, $5)`,
      [userId, hash, expiresAt, userAgent, ip],
    );
    await enforceSessionCap(client, userId);
  });
  return { accessToken, refreshToken: raw };
}

/**
 * Issue a fresh access + refresh token pair for an already-authenticated user.
 * Used by the OAuth flow, where the provider (not a password) proved identity.
 */
export async function issueTokensForUser(userId, context = {}) {
  return issueTokens(userId, context);
}

/** Revoke ALL of a user's active refresh tokens ("sign out everywhere") AND
 *  invalidate every access token issued before now (M1). */
export async function logoutAll(userId) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  await query('UPDATE users SET sessions_invalidated_at = now() WHERE id = $1', [userId]);
}

/**
 * Re-authenticate the current user before a sensitive account mutation (M3):
 * the current password (when the account has one) AND, if 2FA is enabled, a
 * current TOTP/backup code. Throws on failure. A passwordless account with no
 * 2FA has no second factor to re-check — the authenticated session is the only
 * proof (documented residual).
 */
export async function verifyReauth(userId, { password, totpCode } = {}) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) throw AppError.notFound('User not found');
  if (user.password_hash) {
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) throw AppError.badRequest('Your current password is incorrect.');
  }
  if (user.totp_enabled) {
    const valid = await verifyLoginCode(user, totpCode);
    if (!valid) throw AppError.badRequest('Enter a valid authentication code.');
  }
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
  inviteCode,
}) {
  // Hash first so BOTH branches below pay the bcrypt cost — response timing must
  // not reveal whether the email is already registered.
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const existing = await query('SELECT id, email FROM users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    // Do NOT reveal that the account exists and do NOT create a duplicate. Nudge
    // the REAL owner to sign in / reset instead — awaited so timing matches the
    // new-signup path's email send, but its result NEVER changes the API response,
    // which is byte-for-byte identical to the fresh-signup return below.
    await notifyExistingAccount(existing.rows[0].email);
    return { verificationRequired: true, email };
  }

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
  // New email signups start unverified — send the confirmation code and gate
  // access until they confirm it. No tokens are issued yet.
  const result = await sendSignupCode(user);

  // "Deliverable" = Resend actually accepted the send, OR we're in the dev
  // fallback (unconfigured + non-production) where the code is returned in the
  // response. If the code can't reach the user, do NOT leave a half-created,
  // unverifiable account: roll it back so signup can be retried, and surface the
  // failure. The underlying Resend error was already logged in messaging.service.
  const deliverable = result.delivered || Boolean(result.devCode);
  if (!deliverable) {
    await query('DELETE FROM users WHERE id = $1', [user.id]).catch((err) =>
      console.error(`[auth] rollback after undelivered signup code failed for ${user.email}:`, err?.message),
    );
    throw new AppError(502, 'We could not send your verification email. Please try again in a few minutes.');
  }

  // Founding-member assignment: grab a slot if any remain (race-safe, best-effort
  // — never blocks signup). Existing users are covered by the backfill migration.
  await assignFoundingOnSignup(user.id);

  // Spend the invite code now that an account actually exists (best-effort — the
  // gate already authorized this signup; a spent-out race must not fail it).
  if (inviteCode) await consumeInviteCode(inviteCode).catch(() => {});

  return { verificationRequired: true, email: user.email, ...(result.devCode ? { devCode: result.devCode } : {}) };
}

/**
 * Best-effort "you already have an account" notice, sent to the REAL owner when
 * someone attempts to sign up with an already-registered email. This is the only
 * side effect of the exists branch: it sends NO verification code and NO
 * account-activation link (nothing an attacker could use to hijack the flow), and
 * its result is intentionally ignored so the signup API response never depends on
 * it. sendEmail() never throws; the extra try/catch is belt-and-suspenders.
 */
async function notifyExistingAccount(email) {
  const text =
    'Someone tried to create a Summit account with this email, but you already have one. ' +
    'If this was you, just sign in — or use "Forgot password" if you need to reset it. ' +
    "If it wasn't you, no action is needed; your account is unchanged.";
  try {
    await sendEmail({ to: email, subject: 'You already have a Summit account', text });
  } catch {
    /* never let a notification failure affect signup */
  }
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

  // Already verified: signup verification is complete, so this path is done. Do
  // NOT issue tokens and do NOT skip the code check — there is no token shortcut
  // here; the user must log in normally. (Previously this branch issued tokens
  // WITHOUT validating any code, which let anyone who knew a verified email take
  // over the account. That token shortcut is removed.)
  if (user?.email_verified) {
    throw AppError.badRequest('This link is no longer valid. Please sign in.');
  }

  // Tokens are issued ONLY past this point, and ONLY after verifyCode() confirms
  // a code that is valid, unexpired, single-use, and matches THIS account.
  // A missing account and a bad/expired/already-used code both fail generically
  // here with NO tokens (verifyCode does a bcrypt hash-compare and consumes the
  // code on success, so a code can't be replayed).
  if (!user) throw AppError.badRequest('That code is not valid.');
  await verifyCode({ userId: user.id, purpose: 'signup', code });
  await query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]);
  const fresh = (await query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0];
  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(fresh), ...tokens };
}

/* ---- Forgot password (Phase 3): reset via email / recovery email / SMS -- */

/**
 * Send a password-reset code to one of the account's recovery channels:
 *   'email'          → the primary login email
 *   'recovery_email' → the verified backup email
 *   'sms'            → the verified phone
 * Always resolves generically ({ sent: true }) so the response never reveals
 * whether the account — or that channel — exists. In dev (no provider), the code
 * is returned so the flow is testable.
 */
export async function requestPasswordReset({ email, method = 'email' }) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  let channel = 'email';
  let destination = null;
  if (user) {
    if (method === 'sms') {
      if (user.phone && user.phone_verified) { channel = 'sms'; destination = user.phone; }
    } else if (method === 'recovery_email') {
      if (user.recovery_email && user.recovery_email_verified) destination = user.recovery_email;
    } else {
      destination = user.email; // primary email is inherently the login address
    }
  }

  // No account, or the requested channel isn't set up/verified → say nothing.
  if (!user || !destination) return { sent: true };

  const { devCode } = await issueCode({
    userId: user.id,
    purpose: 'password_reset',
    channel,
    destination,
    subject: 'Reset your Summit password',
    intro: 'Your Summit password reset code is',
  });
  return { sent: true, ...(devCode ? { devCode } : {}) };
}

/**
 * Confirm a reset code and set a new password. Revokes every existing session so
 * a compromised old password can't keep a foothold. The user then signs in fresh.
 */
export async function resetPassword({ email, code, newPassword }) {
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  const user = rows[0];
  // Generic failure — don't leak whether the email is registered.
  if (!user) throw AppError.badRequest('That code is not valid. Request a new one.');

  await verifyCode({ userId: user.id, purpose: 'password_reset', code });

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
  // Invalidate all outstanding refresh tokens — every device must re-authenticate.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
  // A reset is a possible-compromise signal: also drop every remembered 2FA
  // device so the next login must complete 2FA again, and invalidate any
  // outstanding access token immediately (M1).
  await revokeAllTrustedDevices(user.id);
  await query('UPDATE users SET sessions_invalidated_at = now() WHERE id = $1', [user.id]);
  return { ok: true };
}

// A pending-deletion account passed full credentials (password, and 2FA when
// enabled) but is deactivated: instead of a real session, hand back a short-lived
// restore challenge so the client shows the "scheduled for deletion — restore?"
// screen. It NEVER gets access/refresh tokens until it is explicitly restored.
function pendingDeletionResponse(user) {
  const scheduledFor = new Date(new Date(user.deleted_at).getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    pendingDeletion: true,
    restoreToken: signRestoreChallenge(user.id),
    deletionScheduledFor: scheduledFor,
    email: user.email,
  };
}

export async function login({ email, password, deviceToken, userAgent, ip }) {
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

  // With 2FA on, hold off on tokens — return a short-lived challenge instead,
  // UNLESS this browser is a remembered trusted device (then skip the 2FA step).
  if (user.totp_enabled) {
    const trusted = await isDeviceTrusted(user.id, deviceToken, { userAgent, ip });
    if (!trusted) {
      return { twoFactorRequired: true, challengeToken: signTwoFactorChallenge(user.id) };
    }
    // fall through to issue tokens — device is trusted
  }

  // Credentials are good, but a soft-deleted account can't get a normal session:
  // route it to the Restore screen instead of silently resurrecting it.
  if (user.deleted_at) return pendingDeletionResponse(user);

  const tokens = await issueTokens(user.id, { userAgent, ip });
  return { user: toPublicUser(user), ...tokens };
}

/**
 * Second login step: validate the TOTP/backup code and issue tokens. When
 * `trustDevice` is set, remember this browser so it can skip 2FA for 30 days;
 * the returned `deviceToken` is stored by the client.
 */
export async function loginTwoFactor({ challengeToken, code, trustDevice: remember, userAgent, ip }) {
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

  // Same guard as password login: a soft-deleted account gets the Restore screen.
  if (user.deleted_at) return pendingDeletionResponse(user);

  const tokens = await issueTokens(user.id, { userAgent, ip });
  // Optionally remember this browser so it can skip 2FA next time (30 days).
  const deviceToken = remember ? await trustDevice(user.id, { userAgent, ip }) : undefined;
  return { user: toPublicUser(user), ...tokens, ...(deviceToken ? { deviceToken } : {}) };
}

/** Rotate a refresh token: revoke the presented one and issue a fresh pair. */
export async function refresh({ refreshToken }) {
  const tokenHash = hashToken(refreshToken);

  // The transaction returns an outcome instead of throwing, so a reuse-detection
  // family revocation COMMITS before we reject (a throw here would roll it back).
  const outcome = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const record = rows[0];
    if (!record) return { status: 'invalid' };

    // Reuse detection (L3): an ALREADY-revoked token is being presented — a
    // replay, the signature of a stolen token. Revoke the ENTIRE rotation family
    // (all live tokens descended from the same login) — committed with this tx —
    // then signal reject.
    if (record.revoked_at !== null) {
      if (record.family_id) {
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL',
          [record.user_id, record.family_id],
        );
      }
      return { status: 'reuse', userId: record.user_id, familyId: record.family_id ?? null };
    }

    if (new Date(record.expires_at) <= new Date()) return { status: 'invalid' };

    // Hard block: refuse to refresh a revoked institution's session (so a hard
    // revoke takes effect within one access-token cycle).
    await assertInstitutionActive(record.user_id);

    // Rotate WITHIN the same family, carrying device context forward. Legacy
    // tokens (pre-migration, no family) get a fresh family here.
    const accessToken = signAccessToken(record.user_id);
    const { raw, hash, expiresAt } = generateRefreshToken();
    const { rows: inserted } = await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id, user_agent, ip)
       VALUES ($1, $2, $3, COALESCE($4, gen_random_uuid()), $5, $6)
       RETURNING id`,
      [record.user_id, hash, expiresAt, record.family_id, record.user_agent, record.ip],
    );
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1',
      [record.id, inserted[0].id],
    );

    return { status: 'ok', accessToken, refreshToken: raw };
  });

  if (outcome.status === 'reuse') {
    logSecurityEvent({
      action: 'refresh_token_reuse',
      outcome: 'failure',
      userId: outcome.userId,
      detail: { family_id: outcome.familyId },
    }).catch(() => {});
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
  if (outcome.status !== 'ok') {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
  return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
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
