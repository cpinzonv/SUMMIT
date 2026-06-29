import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as archives from '../controllers/archives.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(archives.list));

export default router;
