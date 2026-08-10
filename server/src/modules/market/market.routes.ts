import { Router } from 'express';
import { getTechnicalAnalysis } from './market.controller.js';

const router = Router();

router.get('/analyze', getTechnicalAnalysis);

export default router;