import { Router } from 'express';
import { addToWatchlist, getSymbols, getTechnicalAnalysis, getWatchlist } from './market.controller.js';

const router = Router();

router.get('/analyze', getTechnicalAnalysis);
router.get('/symbols', getSymbols);
router.get('/watchlist/:userId', getWatchlist);
router.post('/watchlist', addToWatchlist);

export default router;