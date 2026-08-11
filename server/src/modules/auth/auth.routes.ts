import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';

const router = Router();

// Public Routes
router.post('/google', (req, res) => authController.googleAuth(req, res));
router.post('/refresh', (req, res) => authController.refreshToken(req, res));
router.post('/logout', (req, res) => authController.logout(req, res));

// Protected Routes
router.get('/me', authenticateJWT, (req, res) => authController.getMe(req, res));
router.post('/device', (req, res) => authController.deviceAuth(req, res));


export default router;