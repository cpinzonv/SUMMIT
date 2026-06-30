import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getUserGating, getAllFeatureStatus } from '../services/featureGating.service.js';

// Feature gating status for the current user — per-feature access (lock icons),
// the user's role/tier, and whether billing is live (paywall CTA).
const router = Router();
router.use(requireAuth);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const u = await getUserGating(req.user.id);
    res.json(getAllFeatureStatus(u));
  }),
);

export default router;
