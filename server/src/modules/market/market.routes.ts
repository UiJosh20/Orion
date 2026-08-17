import { Router } from 'express';
import { addToWatchlist, deleteUserPosition, getSymbols, getTechnicalAnalysis, getUserPositions, getWatchlist, saveUserPosition, saveUserRiskConfig, updateUserPosition } from './market.controller.js';

const router = Router();

router.get('/analyze', getTechnicalAnalysis);
router.get('/symbols', getSymbols);
router.get('/watchlist/:userId', getWatchlist);
router.post('/watchlist', addToWatchlist);


router.post('/positions', saveUserPosition);
router.get('/positions/:userId', getUserPositions);
router.put('/positions/:id', updateUserPosition);
router.delete('/positions/:id', deleteUserPosition);


router.post('/risk-config', saveUserRiskConfig);  

export default router;