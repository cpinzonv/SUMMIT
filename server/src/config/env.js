import dotenv from 'dotenv';
import { LMS_PROVIDER_KEYS, envStem } from '../services/lms/providers.js';

dotenv.config();

/**
 * Read an env var, throwing if it is required but missing. Centralizing this
 * means the server fails fast at boot with a clear message instead of blowing
 * up on the first request.
 */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

// Sender used when EMAIL_FROM is unset. MUST be a verified learnsummit.app
// address — NEVER a resend.dev sandbox address, which only delivers to the
// Resend account owner's own inbox (so real signups would get nothing). A
// startup WARNING fires when we fall back to this (see index.js).
const DEFAULT_EMAIL_FROM = 'Summit <noreply@learnsummit.app>';

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '4000')),
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Public base URL of THIS server (used to build OAuth callback URLs that the
  // provider redirects back to, e.g. `${serverUrl}/api/auth/google/callback`).
  serverUrl: optional('SERVER_URL', `http://localhost:${optional('PORT', '4000')}`),
  // Where the SPA lives — OAuth finishes by redirecting the browser here with
  // tokens in the URL fragment (see routes/oauth.routes.js).
  clientUrl: optional('CLIENT_URL', 'http://localhost:5173'),

  databaseUrl: required('DATABASE_URL'),
  databaseSsl: optional('DATABASE_SSL', 'false') === 'true',

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: optional('ACCESS_TOKEN_TTL', '15m'),
    refreshTtlDays: Number(optional('REFRESH_TOKEN_TTL_DAYS', '30')),
  },

  // Optional: only needed for syllabus PDF extraction. Empty string = unconfigured.
  anthropicApiKey: optional('ANTHROPIC_API_KEY', ''),
  anthropicModel: optional('ANTHROPIC_MODEL', 'claude-opus-4-8'),

  // Transactional messaging. Empty = dev fallback: codes are logged server-side
  // and (outside production) returned in the API response so flows are testable.
  resendApiKey: optional('RESEND_API_KEY', ''),
  emailFrom: optional('EMAIL_FROM', DEFAULT_EMAIL_FROM),
  // Whether EMAIL_FROM was actually provided (vs. falling back to DEFAULT_EMAIL_FROM).
  // Presence only — used by the boot sanity log; the value itself is fine to log.
  emailFromFromEnv: Boolean(process.env.EMAIL_FROM),
  twilioSid: optional('TWILIO_ACCOUNT_SID', ''),
  twilioToken: optional('TWILIO_AUTH_TOKEN', ''),
  twilioFrom: optional('TWILIO_FROM', ''),

  // Optional: OpenAI Whisper for lecture speech-to-text (transcription.service).
  // Empty string = unconfigured → recordings still save; auto-transcription is a
  // graceful no-op the student fills in by hand.
  openaiApiKey: optional('OPENAI_API_KEY', ''),
  openaiWhisperModel: optional('OPENAI_WHISPER_MODEL', 'whisper-1'),

  // Optional: ElevenLabs text-to-speech for the two-host podcast audio. Without a
  // key, podcasts still generate a dialogue transcript but audio stays "pending".
  // Two voices — host_a (Maya, curious) and host_b (Sam, expert). ELEVENLABS_VOICE_ID
  // is kept as an alias for voice A for backward compatibility.
  elevenLabs: {
    apiKey: optional('ELEVENLABS_API_KEY', ''),
    voiceIdA: optional('ELEVENLABS_VOICE_ID_A', optional('ELEVENLABS_VOICE_ID', 'EXAVITQu4vr4xnSDxMaL')), // Sarah (warm)
    voiceIdB: optional('ELEVENLABS_VOICE_ID_B', 'JBFqnCBsd6RMkjVDRZzb'), // George (narrator)
    model: optional('ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
  },

  // One-time token for the first-admin bootstrap endpoint. Unset = disabled.
  adminSetupToken: optional('SETUP_TOKEN', ''),

  // Billing master switch. false = premium features are gated and the paywall is
  // "coming soon" (no checkout yet); true = subscriptions can be sold (Stripe,
  // future). The access gate itself is always enforced (admin/demo/premium bypass).
  billingEnabled: optional('BILLING_ENABLED', 'false') === 'true',

  // OAuth social login. Each provider is OPTIONAL — its button/endpoint only
  // activates when its credentials are present (same optional-feature pattern as
  // ANTHROPIC_API_KEY / the LMS providers). isOAuthProviderConfigured() below
  // reports which are live so the client can show only those buttons.
  oauth: {
    google: {
      clientId: optional('GOOGLE_OAUTH_CLIENT_ID', ''),
      clientSecret: optional('GOOGLE_OAUTH_CLIENT_SECRET', ''),
    },
    github: {
      clientId: optional('GITHUB_OAUTH_CLIENT_ID', ''),
      clientSecret: optional('GITHUB_OAUTH_CLIENT_SECRET', ''),
    },
    apple: {
      // Apple's "Service ID" is the OAuth client_id; the client secret is an
      // ES256 JWT signed from the .p8 key (passport-apple builds it for us).
      clientId: optional('APPLE_OAUTH_CLIENT_ID', ''),
      teamId: optional('APPLE_OAUTH_TEAM_ID', ''),
      keyId: optional('APPLE_OAUTH_KEY_ID', ''),
      // The .p8 private key contents. Newlines may be escaped as \n in the env.
      privateKey: optional('APPLE_OAUTH_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
    },
  },

  // Symmetric key (64 hex chars) for encrypting secrets at rest — LMS OAuth
  // tokens AND 2FA secrets/backup codes. Prefers APP_ENCRYPTION_KEY, falling
  // back to the original LMS_TOKEN_ENC_KEY for backward compatibility.
  // Generate with: openssl rand -hex 32
  encryptionKey: optional('APP_ENCRYPTION_KEY', '') || optional('LMS_TOKEN_ENC_KEY', ''),

  // LMS integration (Canvas, Blackboard, Google Classroom, Brightspace, Moodle,
  // Sakai). All optional — a provider 503s until configured, exactly like the
  // syllabus/Anthropic feature. Every provider shares this block; per-provider
  // credentials live under lms.providers[<key>] (see services/lms/providers.js).
  lms: {
    // 32-byte key (64 hex chars) for encrypting stored OAuth tokens at rest.
    // Generate with: openssl rand -hex 32
    tokenEncKey: optional('LMS_TOKEN_ENC_KEY', ''),
    // Where a provider sends the user back after consent (a frontend route).
    redirectUri: optional('LMS_REDIRECT_URI', 'http://localhost:5173/lms/callback'),
    // Global dev switch: use the in-memory fixture LMS for EVERY provider instead
    // of calling real APIs. Lets the whole connect→sync→import pipeline run with
    // no credentials and no network. Individual providers can also be mocked on
    // their own with MOCK_<KEY>_MODE=true (e.g. MOCK_BLACKBOARD_MODE=true).
    useMock: optional('LMS_MOCK', 'false') === 'true',
    // Per-provider credentials + mock flag, keyed by provider key.
    //   CANVAS_CLIENT_ID / CANVAS_CLIENT_SECRET / MOCK_CANVAS_MODE
    //   BLACKBOARD_CLIENT_ID / ... / MOCK_BLACKBOARD_MODE
    //   GOOGLE_CLASSROOM_CLIENT_ID / ... / MOCK_GOOGLE_CLASSROOM_MODE
    //   BRIGHTSPACE_CLIENT_ID / MOODLE_CLIENT_ID / SAKAI_CLIENT_ID ...
    providers: Object.fromEntries(
      LMS_PROVIDER_KEYS.map((key) => {
        const STEM = envStem(key);
        return [
          key,
          {
            clientId: optional(`${STEM}_CLIENT_ID`, ''),
            clientSecret: optional(`${STEM}_CLIENT_SECRET`, ''),
            // Per-provider mock override (in addition to the global LMS_MOCK).
            mock: optional(`MOCK_${STEM}_MODE`, 'false') === 'true',
          },
        ];
      }),
    ),
  },
};

// Google Calendar one-way sync (separate from the LMS providers).
env.gcal = {
  clientId: optional('GOOGLE_CALENDAR_CLIENT_ID', ''),
  clientSecret: optional('GOOGLE_CALENDAR_CLIENT_SECRET', ''),
  // Dev: simulate Google Calendar (no network) so the connect/sync flow works
  // with no credentials. Honors the global LMS_MOCK too.
  useMock: optional('LMS_MOCK', 'false') === 'true' || optional('MOCK_GOOGLE_CALENDAR_MODE', 'false') === 'true',
};

// Back-compat alias: canvas.js historically read env.lms.canvas.*
env.lms.canvas = env.lms.providers.canvas;

/** True when the named provider should use the in-memory mock. */
export function providerUsesMock(key) {
  return env.lms.useMock || Boolean(env.lms.providers[key]?.mock);
}

/** True when an OAuth social-login provider has the credentials it needs. */
export function isOAuthProviderConfigured(provider) {
  const c = env.oauth[provider];
  if (!c) return false;
  if (provider === 'apple') {
    return Boolean(c.clientId && c.teamId && c.keyId && c.privateKey);
  }
  return Boolean(c.clientId && c.clientSecret);
}

/** The list of OAuth providers that are currently live (credentials present). */
export function configuredOAuthProviders() {
  return ['google', 'apple', 'github'].filter(isOAuthProviderConfigured);
}

export const isProd = env.nodeEnv === 'production';
