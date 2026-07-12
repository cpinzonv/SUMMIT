/**
 * OAuth social-login routes (Google / Apple / GitHub).
 *
 * Flow (redirect style — see PART 7):
 *   GET  /api/auth/:provider          → redirect to the provider with a signed
 *                                        `state` (CSRF) param.
 *   GET  /api/auth/:provider/callback → provider redirects back; passport
 *   POST /api/auth/apple/callback        exchanges the code + gives us a profile;
 *                                        we verify state, issue Summit JWTs, and
 *                                        bounce the browser to the SPA with the
 *                                        tokens in the URL FRAGMENT (never the
 *                                        query string — fragments aren't logged
 *                                        or sent to servers).
 *
 * Un-configured providers (no credentials) have no passport strategy; their
 * routes redirect back to the login page with an error instead of 500ing.
 */
import { Router } from 'express';
import { passport } from '../config/passport.js';
import { env, configuredOAuthProviders, isOAuthProviderConfigured } from '../config/env.js';
import { signOAuthState, verifyOAuthState, signTwoFactorChallenge, signRestoreChallenge } from '../utils/jwt.js';
import { issueTokensForUser } from '../services/auth.service.js';
import { getRegistrationMode } from '../services/registration.service.js';

const router = Router();

const PROVIDERS = ['google', 'apple', 'github'];

// Per-provider scopes (also set on the strategy; passed here so the redirect
// carries them too). Apple requires `response_mode=form_post` when name/email
// scopes are requested — passport-apple sets that for us.
const SCOPES = {
  google: ['profile', 'email'],
  github: ['user:email'],
  apple: ['name', 'email'],
};

/** Tells the client which social buttons to show (only configured providers),
 *  and whether public registration is open or invite_only (so the register page
 *  can show the waitlist panel while closed). The mode is admin-controlled. */
router.get('/providers', async (req, res, next) => {
  try {
    res.json({ providers: configuredOAuthProviders(), registrationMode: await getRegistrationMode() });
  } catch (err) {
    next(err);
  }
});

/** Send the browser to the SPA login page with a short error code in the hash. */
function redirectError(res, code) {
  res.redirect(`${env.clientUrl}/login#error=${encodeURIComponent(code)}`);
}

/** Send the browser to the SPA callback page with fresh tokens in the hash. */
function redirectSuccess(res, { accessToken, refreshToken }) {
  const params = new URLSearchParams({ accessToken, refreshToken });
  res.redirect(`${env.clientUrl}/auth/callback#${params.toString()}`);
}

/** 2FA-enabled account: bounce to the SPA with a short-lived challenge instead of
 *  tokens, so the same TOTP step the password flow uses gates the session (M4). */
function redirectTwoFactor(res, challengeToken) {
  const params = new URLSearchParams({ twoFactorRequired: '1', challengeToken });
  res.redirect(`${env.clientUrl}/auth/callback#${params.toString()}`);
}

/** Soft-deleted account: bounce to the SPA with a restore challenge instead of
 *  tokens, so it lands on the "scheduled for deletion — restore?" screen. */
function redirectRestore(res, restoreToken) {
  const params = new URLSearchParams({ pendingDeletion: '1', restoreToken });
  res.redirect(`${env.clientUrl}/auth/callback#${params.toString()}`);
}

for (const provider of PROVIDERS) {
  // --- Step 1: initiate -----------------------------------------------------
  router.get(`/${provider}`, (req, res, next) => {
    if (!isOAuthProviderConfigured(provider)) return redirectError(res, 'provider_unavailable');
    const state = signOAuthState();
    passport.authenticate(provider, {
      session: false,
      state,
      scope: SCOPES[provider],
    })(req, res, next);
  });

  // --- Step 2: callback -----------------------------------------------------
  // GitHub/Google redirect with GET; Apple POSTs (form_post). Register both so
  // a single handler covers every provider.
  const handleCallback = (req, res, next) => {
    if (!isOAuthProviderConfigured(provider)) return redirectError(res, 'provider_unavailable');

    // Verify the CSRF state we issued in step 1 round-tripped intact.
    const state = req.query.state || req.body?.state;
    try {
      verifyOAuthState(state);
    } catch {
      return redirectError(res, 'invalid_state');
    }

    passport.authenticate(provider, { session: false }, async (err, user) => {
      // User denied consent, provider error, unverified email, or no email.
      if (err) {
        let code = 'oauth_failed';
        if (err.details?.code === 'oauth_email_unverified') code = 'email_unverified';
        else if (err.statusCode === 400) code = 'no_email';
        return redirectError(res, code);
      }
      if (!user) return redirectError(res, 'access_denied');
      try {
        // If the account has 2FA, do NOT issue tokens here — require the TOTP
        // step first, exactly like password login (M4).
        if (user.totp_enabled) {
          return redirectTwoFactor(res, signTwoFactorChallenge(user.id));
        }
        // Soft-deleted account (no 2FA): route to Restore rather than a session.
        if (user.deleted_at) {
          return redirectRestore(res, signRestoreChallenge(user.id));
        }
        const tokens = await issueTokensForUser(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
        return redirectSuccess(res, tokens);
      } catch {
        return redirectError(res, 'token_error');
      }
    })(req, res, next);
  };

  router.get(`/${provider}/callback`, handleCallback);
  if (provider === 'apple') router.post(`/${provider}/callback`, handleCallback);
}

export default router;
