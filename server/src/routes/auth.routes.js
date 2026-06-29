import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post(
  '/register',
  validate(authController.registerSchema),
  asyncHandler(authController.register),
);

router.post(
  '/login',
  validate(authController.loginSchema),
  asyncHandler(authController.login),
);

router.post(
  '/refresh',
  validate(authController.refreshSchema),
  asyncHandler(authController.refresh),
);

router.post(
  '/logout',
  validate(authController.refreshSchema),
  asyncHandler(authController.logout),
);

router.get('/me', requireAuth, asyncHandler(authController.me));

export default router;
