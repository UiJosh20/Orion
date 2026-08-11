import { Router } from 'express';
import { registerDeviceSession } from './session.controller.js';

const router = Router();

// POST /api/session/device
router.post('/device', registerDeviceSession);

export default router;