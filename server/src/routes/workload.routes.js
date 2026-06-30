import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { weeklyWorkload } from '../services/workload.service.js';

const router = Router();
router.use(requireAuth);

// Total estimated hours due this week + next week, with a per-day breakdown.
router.get(
  '/weekly',
  asyncHandler(async (req, res) => {
    res.json(await weeklyWorkload(req.user.id));
  }),
);

export default router;
