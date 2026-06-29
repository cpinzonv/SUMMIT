import { AppError } from '../utils/AppError.js';

/**
 * Validate part of the request against a Zod schema, replacing it with the
 * parsed (and coerced) value. Usage:
 *
 *   router.post('/', validate(registerSchema), controller.register);
 *   router.get('/', validate(listQuerySchema, 'query'), controller.list);
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(AppError.badRequest('Validation failed', details));
    }
    req[source] = result.data;
    next();
  };
}
