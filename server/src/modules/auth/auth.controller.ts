import { Request, Response } from 'express';
import { authService } from './auth.service.js';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware.js';
import pgPool from '../../config/db.js';

const COOKIE_NAME = 'orion_rt';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class AuthController {
  /**
   * Helper to set HttpOnly Cookie
   */
  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(COOKIE_NAME, refreshToken, {
      httpOnly: true, // Prevents XSS script access
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict', // Protects against CSRF
      path: '/api/auth/refresh', // Restricts cookie scope to refresh endpoint only
      maxAge: SEVEN_DAYS_MS,
    });
  }

  async googleAuth(req: Request, res: Response) {
    try {
      const { idToken } = req.body;
      const deviceUuid = req.headers['x-device-uuid'] as string;

      if (!idToken) {
        return res.status(400).json({ error: 'idToken is required' });
      }

      const { user, accessToken, refreshToken } = await authService.authenticateGoogleUser(idToken, deviceUuid);

      // Attach refresh token as HttpOnly Cookie
      this.setRefreshCookie(res, refreshToken);

      return res.status(200).json({
        message: 'Authenticated successfully',
        accessToken,
        user,
      });
    } catch (error: any) {
      return res.status(401).json({ error: error.message || 'Authentication failed' });
    }
  }

  async refreshToken(req: Request, res: Response) {
    try {
      const incomingRefreshToken = req.cookies?.[COOKIE_NAME] || req.body?.refreshToken;

      if (!incomingRefreshToken) {
        return res.status(401).json({ error: 'Refresh token missing' });
      }

      const { accessToken, refreshToken: newRefreshToken } = await authService.rotateRefreshToken(
        incomingRefreshToken
      );

      // Rotate cookie
      this.setRefreshCookie(res, newRefreshToken);

      return res.status(200).json({ accessToken });
    } catch (error: any) {
      res.clearCookie(COOKIE_NAME, { path: '/api/auth/refresh' });
      return res.status(401).json({ error: error.message || 'Invalid refresh token' });
    }
  }

  async logout(req: Request, res: Response) {
    const refreshToken = req.cookies?.[COOKIE_NAME];
    await authService.logoutSession(refreshToken);

    res.clearCookie(COOKIE_NAME, { path: '/api/auth/refresh' });
    return res.status(200).json({ message: 'Logged out successfully' });
  }

  async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      const { rows } = await pgPool.query(
        `SELECT id, email, name, avatar_url, created_at FROM users WHERE id = $1`,
        [req.user?.userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({ user: rows[0] });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to retrieve profile' });
    }
  }
  
  async deviceAuth(req: Request, res: Response) {
    try {
      const deviceUuid = req.headers['x-device-uuid'] as string;

      if (!deviceUuid) {
        return res.status(400).json({ error: 'deviceUuid is required' });
      }

      const { user, accessToken, refreshToken } = await authService.authenticateDeviceSession(deviceUuid);

      // Attach refresh token as HttpOnly Cookie
      this.setRefreshCookie(res, refreshToken);

      return res.status(200).json({
        message: 'Authenticated successfully',
        accessToken,
        user,
      });
    } catch (error: any) {
      return res.status(401).json({ error: error.message || 'Authentication failed' });
    }
  }
}

export const authController = new AuthController();