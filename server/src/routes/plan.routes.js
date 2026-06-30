import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as plan from '../controllers/plan.controller.js';

// 4-year academic plan.
const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(plan.get));
router.post('/', validate(plan.createSchema), asyncHandler(plan.create));
router.patch(
  '/:itemId',
  validate(plan.itemIdParam, 'params'),
  validate(plan.updateSchema),
  asyncHandler(plan.update),
);
router.delete(
  '/:itemId',
  validate(plan.itemIdParam, 'params'),
  asyncHandler(plan.remove),
);

export default router;
