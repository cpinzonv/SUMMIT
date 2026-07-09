import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import apiRoutes from './routes/index.js';
import { initPassport } from './config/passport.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';

export function createApp() {
  const app = express();

  // Behind Railway's proxy — trust the first hop so req.ip is the real client
  // (correct rate-limit keying) without trusting arbitrary X-Forwarded-For.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Clickjacking: deny framing outright (helmet defaults to SAMEORIGIN).
      frameguard: { action: 'deny' },
      // HSTS: force HTTPS for a year, including subdomains.
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json());
  // Apple's OAuth callback is an application/x-www-form-urlencoded POST.
  app.use(express.urlencoded({ extended: false }));
  // Register OAuth strategies for configured providers (stateless, session:false).
  app.use(initPassport().initialize());
  app.use(morgan(isProd ? 'combined' : 'dev'));

  // Liveness probe (used by Railway and the desktop/web clients).
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Global rate-limit ceiling for the whole API (per-route stricter limits are
  // applied inside the auth routes). Health check above is intentionally exempt.
  app.use('/api', apiLimiter, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
