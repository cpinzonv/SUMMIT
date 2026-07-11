/**
 * Passport strategy registration for OAuth social login.
 *
 * Strategies are registered ONLY for providers that have credentials (so an
 * un-configured provider simply has no strategy and its routes 404/redirect
 * with an error — the same optional-feature pattern used elsewhere). Every
 * strategy runs with `session: false`: Summit is stateless and issues its own
 * JWTs, so passport is used purely to do the provider handshake and hand us a
 * normalized profile. CSRF is handled by a signed-JWT `state` param in the
 * routes, not by passport's session-backed state store.
 */
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import AppleStrategy from 'passport-apple';
import { env, isOAuthProviderConfigured } from './env.js';
import { findOrCreateOAuthUser } from '../services/oauth.service.js';

const callbackUrl = (provider) => `${env.serverUrl}/api/auth/${provider}/callback`;

/** Wrap the async find-or-create so any error is surfaced to passport cleanly. */
function verify(mapProfile) {
  return (...args) => {
    // Signatures differ per strategy; the LAST arg is always passport's `done`.
    const done = args[args.length - 1];
    Promise.resolve()
      .then(() => mapProfile(...args))
      .then((profile) => findOrCreateOAuthUser(profile))
      .then((user) => done(null, user))
      .catch((err) => done(err));
  };
}

let initialized = false;

/** Register strategies for every configured provider. Safe to call once at boot. */
export function initPassport() {
  if (initialized) return passport;
  initialized = true;

  if (isOAuthProviderConfigured('google')) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: env.oauth.google.clientId,
          clientSecret: env.oauth.google.clientSecret,
          callbackURL: callbackUrl('google'),
          scope: ['profile', 'email'],
        },
        verify((_accessToken, _refreshToken, profile) => ({
          provider: 'google',
          providerId: profile.id,
          email: profile.emails?.[0]?.value,
          // Google returns an email_verified flag; only trust a verified address.
          emailVerified: profile._json?.email_verified === true || profile.emails?.[0]?.verified === true,
          fullName: profile.displayName,
        })),
      ),
    );
  }

  if (isOAuthProviderConfigured('github')) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: env.oauth.github.clientId,
          clientSecret: env.oauth.github.clientSecret,
          callbackURL: callbackUrl('github'),
          scope: ['user:email'],
        },
        verify((_accessToken, _refreshToken, profile) => {
          // GitHub can return unverified emails. Trust ONLY a verified one (prefer
          // the primary); never fall back to an unverified address — otherwise an
          // attacker who lists a victim's email on their own GitHub account gets
          // linked into the victim's Summit account (SECURITY_AUDIT_2 H1).
          const verified =
            profile.emails?.find((e) => e.primary && e.verified) ||
            profile.emails?.find((e) => e.verified);
          return {
            provider: 'github',
            providerId: String(profile.id),
            email: verified?.value,
            emailVerified: Boolean(verified),
            fullName: profile.displayName || profile.username,
            handle: profile.username,
          };
        }),
      ),
    );
  }

  if (isOAuthProviderConfigured('apple')) {
    passport.use(
      new AppleStrategy(
        {
          clientID: env.oauth.apple.clientId,
          teamID: env.oauth.apple.teamId,
          keyID: env.oauth.apple.keyId,
          privateKeyString: env.oauth.apple.privateKey,
          callbackURL: callbackUrl('apple'),
          scope: ['name', 'email'],
          passReqToCallback: true,
        },
        // Apple's verify: (req, accessToken, refreshToken, idToken, profile, done).
        // The decoded idToken carries sub + email; the name is POSTed in req.body
        // (as JSON) only on the very first authorization.
        verify((req, _accessToken, _refreshToken, idToken) => {
          let firstName = '';
          let lastName = '';
          try {
            const u = req.body?.user ? JSON.parse(req.body.user) : null;
            firstName = u?.name?.firstName || '';
            lastName = u?.name?.lastName || '';
          } catch {
            /* ignore malformed user payload */
          }
          return {
            provider: 'apple',
            providerId: idToken.sub,
            email: idToken.email,
            // Apple sends email_verified as a boolean or the string "true".
            emailVerified: idToken.email_verified === true || idToken.email_verified === 'true',
            fullName: [firstName, lastName].filter(Boolean).join(' ') || undefined,
          };
        }),
      ),
    );
  }

  return passport;
}

export { passport };
