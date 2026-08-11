import { Router } from 'express';
import { createAlertController, getActiveAlertsController } from './alert.controller.js';

const router = Router();
router.post('/create', createAlertController);

router.get('/active', getActiveAlertsController);

export default router;