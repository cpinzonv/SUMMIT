import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getFeatureStatus } from '../services/featureGating.service.js';

// Feature gating status for the current user (which premium features are
// unlocked + whether billing is live). Drives lock icons + the paywall.
const router = Router();
router.use(requireAuth);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json(await getFeatureStatus(req.user.id));
  }),
);

export default router;
