import dotenv from 'dotenv';

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

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '4000')),
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

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

  // LMS integration (Canvas, etc.). All optional — the feature 503s until
  // configured, exactly like the syllabus/Anthropic feature.
  lms: {
    // 32-byte key (64 hex chars) for encrypting stored OAuth tokens at rest.
    // Generate with: openssl rand -hex 32
    tokenEncKey: optional('LMS_TOKEN_ENC_KEY', ''),
    // Where Canvas sends the user back after consent (a frontend route).
    redirectUri: optional('LMS_REDIRECT_URI', 'http://localhost:5173/lms/callback'),
    // Dev mode: use an in-memory fixture LMS instead of calling a real Canvas.
    // Lets the whole connect→sync→import pipeline run without credentials.
    useMock: optional('LMS_MOCK', 'false') === 'true',
    canvas: {
      clientId: optional('CANVAS_CLIENT_ID', ''),
      clientSecret: optional('CANVAS_CLIENT_SECRET', ''),
    },
  },
};

export const isProd = env.nodeEnv === 'production';
