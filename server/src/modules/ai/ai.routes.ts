import { Router } from 'express';
import { getAiMarketInsight } from './ai.controller.js';

const router = Router();

router.get('/insight', getAiMarketInsight);

export default router;