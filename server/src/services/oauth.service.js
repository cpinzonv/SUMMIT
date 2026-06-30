/**
 * OAuth social login — resolve a provider profile to a Summit user account.
 *
 * Resolution order (see PART 5 of the feature spec):
 *   1. Match by provider id  → existing social account, log in.
 *   2. Match by email        → existing account (email or another provider),
 *                              LINK this provider to it and log in.
 *   3. No match              → create a brand-new account for this provider.
 *
 * Linking by email is safe because every provider we support returns a
 * provider-verified email (Google/Apple verify; GitHub gives the verified
 * primary email when the `user:email` scope is granted). Accounts created this
 * way have NO password until the user sets one (password_hash stays NULL).
 */
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

// Per-provider columns: the unique id column, and the "handle" column that
// stores the provider's email (Google/Apple) or username (GitHub).
const PROVIDERS = {
  google: { idCol: 'google_id', handleCol: 'google_email' },
  apple: { idCol: 'apple_id', handleCol: 'apple_email' },
  github: { idCol: 'github_id', handleCol: 'github_username' },
};

/**
 * Find or create the user for an OAuth profile.
 * @param {object} profile
 * @param {'google'|'apple'|'github'} profile.provider
 * @param {string} profile.providerId  the provider's stable user id (sub / id)
 * @param {string} [profile.email]     provider-verified email, if shared
 * @param {string} [profile.fullName]  display name, used only when creating
 * @param {string} [profile.handle]    e.g. GitHub username (stored as github_username)
 * @returns {Promise<object>} the user row
 */
export async function findOrCreateOAuthUser({ provider, providerId, email, fullName, handle }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw AppError.badRequest(`Unknown OAuth provider: ${provider}`);
  if (!providerId) throw AppError.badRequest('OAuth profile is missing an id.');

  const normalizedEmail = email ? String(email).toLowerCase() : null;

  return withTransaction(async (client) => {
    // 1) Already linked to this provider id → just log in.
    const byProvider = await client.query(
      `SELECT * FROM users WHERE ${cfg.idCol} = $1`,
      [providerId],
    );
    if (byProvider.rows[0]) return byProvider.rows[0];

    // 2) An account with this email exists → link the provider to it.
    if (normalizedEmail) {
      const byEmail = await client.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
      const existing = byEmail.rows[0];
      if (existing) {
        const { rows } = await client.query(
          `UPDATE users
              SET ${cfg.idCol} = $1,
                  ${cfg.handleCol} = COALESCE($2, ${cfg.handleCol})
            WHERE id = $3
            RETURNING *`,
          [providerId, handle ?? normalizedEmail, existing.id],
        );
        return rows[0];
      }
    }

    // 3) Brand-new account. OAuth accounts need an email; if the provider didn't
    // share one (e.g. Apple "Hide My Email" relays still send one, but a GitHub
    // user with no public/verified email might not) we can't create the account.
    if (!normalizedEmail) {
      throw AppError.badRequest(
        'Your account did not share an email address, which Summit needs to create an account.',
      );
    }

    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, auth_method, ${cfg.idCol}, ${cfg.handleCol})
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [normalizedEmail, fullName || normalizedEmail.split('@')[0], provider, providerId, handle ?? normalizedEmail],
    );
    return rows[0];
  });
}

/**
 * Link a provider to an ALREADY-authenticated user (Settings → "Link account").
 * Fails if the provider id is already attached to a different account.
 */
export async function linkProviderToUser(userId, { provider, providerId, email, handle }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw AppError.badRequest(`Unknown OAuth provider: ${provider}`);

  const clash = await query(`SELECT id FROM users WHERE ${cfg.idCol} = $1`, [providerId]);
  if (clash.rows[0] && clash.rows[0].id !== userId) {
    throw AppError.conflict('That account is already linked to another Summit user.');
  }
  const { rows } = await query(
    `UPDATE users
        SET ${cfg.idCol} = $1,
            ${cfg.handleCol} = COALESCE($2, ${cfg.handleCol})
      WHERE id = $3
      RETURNING *`,
    [providerId, handle ?? (email ? String(email).toLowerCase() : null), userId],
  );
  if (!rows[0]) throw AppError.notFound('User not found.');
  return rows[0];
}
