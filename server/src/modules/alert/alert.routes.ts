import { Router } from 'express';
import { createAlertController, getActiveAlertsController } from './alert.controller.js';

const router = Router();
router.post('/', createAlertController);

router.get('/', getActiveAlertsController);

export default router;