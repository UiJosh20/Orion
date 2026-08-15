import { Request, Response } from "express";
import { authService } from "./auth.service.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import pgPool from "../../config/db.js";

const REFRESH_COOKIE_NAME = "orion_rt";
const ACCESS_COOKIE_NAME = "orion_at";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FIFTEEN_MINS_MS = 15 * 60 * 1000;

export class AuthController {
  /**
   * Helper to set Access Token HttpOnly Cookie (Global scope)
   */
  private setAccessCookie(res: Response, accessToken: string) {
    res.cookie(ACCESS_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/", // Sent on all API requests including /api/auth/me
      maxAge: FIFTEEN_MINS_MS,
    });
  }

  /**
   * Helper to set Refresh Token HttpOnly Cookie (Refresh endpoint scope)
   */
  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/refresh",
      maxAge: SEVEN_DAYS_MS,
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE_NAME, { path: "/" });
    res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth/refresh" });
  }

  async googleAuth(req: Request, res: Response) {
    try {
      const { idToken } = req.body;
      const deviceUuid = req.headers["x-device-uuid"] as string;

      if (!idToken) {
        return res.status(400).json({ error: "idToken is required" });
      }

      const { user, accessToken, refreshToken } =
        await authService.authenticateGoogleUser(idToken, deviceUuid);

      this.setAccessCookie(res, accessToken);
      this.setRefreshCookie(res, refreshToken);

      return res.status(200).json({
        message: "Authenticated successfully",
        user,
      });
    } catch (error: any) {
      console.error("[Google Auth Error]:", error);
      return res
        .status(401)
        .json({ error: error.message || "Authentication failed" });
    }
  }

  async deviceAuth(req: Request, res: Response) {
    try {
      // Check both request header and body payload
      const deviceUuid =
        (req.headers["x-device-uuid"] as string) || req.body?.deviceUuid;

      if (!deviceUuid) {
        return res.status(400).json({ error: "deviceUuid is required" });
      }

      const { user, accessToken, refreshToken } =
        await authService.authenticateDeviceSession(deviceUuid);

      this.setAccessCookie(res, accessToken);
      this.setRefreshCookie(res, refreshToken);

      return res.status(200).json({
        message: "Authenticated successfully",
        user,
      });
    } catch (error: any) {
      return res
        .status(401)
        .json({ error: error.message || "Authentication failed" });
    }
  }

  async refreshToken(req: Request, res: Response) {
    try {
      const incomingRefreshToken =
        req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

      if (!incomingRefreshToken) {
        return res.status(401).json({ error: "Refresh token missing" });
      }

      const { accessToken, refreshToken: newRefreshToken } =
        await authService.rotateRefreshToken(incomingRefreshToken);

      this.setAccessCookie(res, accessToken);
      this.setRefreshCookie(res, newRefreshToken);

      return res.status(200).json({ message: "Token refreshed successfully" });
    } catch (error: any) {
      this.clearAuthCookies(res);
      return res
        .status(401)
        .json({ error: error.message || "Invalid refresh token" });
    }
  }

  async logout(req: Request, res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    await authService.logoutSession(refreshToken);

    this.clearAuthCookies(res);
    return res.status(200).json({ message: "Logged out successfully" });
  }

  async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      const { rows } = await pgPool.query(
        `SELECT id, email, name, avatar_url, created_at FROM users WHERE id = $1`,
        [req.user?.userId],
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.status(200).json({ user: rows[0] });
    } catch (error) {
      return res.status(500).json({ error: "Failed to retrieve profile" });
    }
  }
}

export const authController = new AuthController();
