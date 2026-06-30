import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import apiRoutes from './routes/index.js';
import { initPassport } from './config/passport.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(helmet());
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

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
