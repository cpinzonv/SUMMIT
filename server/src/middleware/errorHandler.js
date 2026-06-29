import { AppError } from '../utils/AppError.js';
import { isProd } from '../config/env.js';

/** 404 handler for unmatched routes — runs after all routers. */
export function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Central error handler. Express recognizes it by its four arguments. Known
 * AppErrors map to their status; everything else is a 500 with details hidden
 * in production.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { message: err.message, details: err.details },
    });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: {
      message: isProd ? 'Internal server error' : err.message,
    },
  });
}
