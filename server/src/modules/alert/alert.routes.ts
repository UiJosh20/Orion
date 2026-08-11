import { Router } from 'express';
import { createAlertController, getActiveAlertsController, testAlertController } from './alert.controller.js';

const router = Router();
router.post('/create', createAlertController);

router.get('/active', getActiveAlertsController);
router.post('/test', testAlertController);

export default router;