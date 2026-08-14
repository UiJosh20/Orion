import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pgPool from "../../config/db.js";
import { redisClient } from "../../config/redis.js";
import { ENV } from "../../config/env.js";

const googleClient = new OAuth2Client(ENV.GOOGLE_CLIENT_ID);

const ACCESS_TOKEN_EXPIRY = "15m"; // 15 minutes
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

export class AuthService {
 /**
 * 1a. Google OAuth Authentication & Migration
 */
async authenticateGoogleUser(idToken: string, deviceUuid?: string) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: ENV.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Invalid Google token payload");
  }

  const { sub: googleId, email, name, picture: avatarUrl } = payload;
  const dbClient = await pgPool.connect();

  try {
    await dbClient.query("BEGIN");

    // 1. Upsert User
    const userUpsertQuery = `
      INSERT INTO users (email, google_id, name, avatar_url, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (google_id)
      DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
      RETURNING id, email, name, avatar_url, created_at;
    `;
    const { rows } = await dbClient.query(userUpsertQuery, [
      email,
      googleId,
      name,
      avatarUrl,
    ]);
    const user = rows[0];

    // 2. Migrate Guest Data safely if deviceUuid exists
    if (deviceUuid) {
      // Step A: Delete guest watchlist items that the user already has saved
      await dbClient.query(
        `
        DELETE FROM user_watchlist
        WHERE user_id = $2
          AND symbol IN (
            SELECT symbol FROM user_watchlist WHERE user_id = $1
          );
        `,
        [user.id, deviceUuid]
      );

      // Step B: Re-assign all remaining unique guest watchlist items to the user
      await dbClient.query(
        `UPDATE user_watchlist SET user_id = $1 WHERE user_id = $2;`,
        [user.id, deviceUuid]
      );

      // Step C: Re-assign guest alerts to the user
      await dbClient.query(
        `UPDATE user_alerts SET user_id = $1 WHERE user_id = $2;`,
        [user.id, deviceUuid]
      );
    }

    await dbClient.query("COMMIT");

    // 3. Generate Tokens
    const tokens = await this.issueTokenPair(user.id, user.email);

    return { user, ...tokens };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}
  /**
   * 1b. Device Session Authentication (Guest Tokens with Random Names)
   */
async authenticateDeviceSession(deviceUuid: string) {
    if (!deviceUuid) {
      throw new Error("Device UUID is required");
    }

    const guestEmail = `${deviceUuid}@device.local`;

    // Pool of fun random guest names tailored for a trading platform
    const guestNames = [
      "Anonymous Trader",
      "Silent Bull",
      "Crypto Nomad",
      "Market Explorer",
      "Shadow Analyst",
      "Quant Guest",
      "Chart Watcher",
    ];

    // Pick a name deterministically based on the deviceUuid characters
    const nameIndex =
      deviceUuid
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0) % guestNames.length;
    const guestName = guestNames[nameIndex];

    const dbClient = await pgPool.connect();
    try {
      // Upsert guest user into the users table so /auth/me can find them
      const userUpsertQuery = `
        INSERT INTO users (id, email, name, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (id)
        DO UPDATE SET updated_at = NOW()
        RETURNING id, email, name, avatar_url, created_at;
      `;
      const { rows } = await dbClient.query(userUpsertQuery, [
        deviceUuid,
        guestEmail,
        guestName,
      ]);
      const user = rows[0];

      // Generate Tokens
      const tokens = await this.issueTokenPair(user.id, user.email);

      console.log("[device auth success for user]:", user.id);
      return { user, ...tokens };
    } catch (error) {
      throw error;
    } finally {
      dbClient.release();
    }
  }
  /**
   * 2. Refresh Token Rotation (RTR) Engine
   */
  async rotateRefreshToken(incomingRefreshToken: string) {
    try {
      const decoded = jwt.verify(
        incomingRefreshToken,
        ENV.JWT_REFRESH_SECRET || "refresh_secret_fallback",
      ) as { userId: string; email: string; tokenId: string };

      const redisKey = `refresh_token:${decoded.userId}:${decoded.tokenId}`;
      const storedToken = await redisClient.get(redisKey);

      if (!storedToken || storedToken !== incomingRefreshToken) {
        await this.revokeAllUserSessions(decoded.userId);
        throw new Error(
          "Security Alert: Refresh token reuse detected. All sessions revoked.",
        );
      }

      await redisClient.del(redisKey);
      const tokens = await this.issueTokenPair(decoded.userId, decoded.email);
      return { userId: decoded.userId, ...tokens };
    } catch (error: any) {
      throw new Error(error.message || "Invalid or expired refresh token");
    }
  }

  /**
   * 3. Revoke Session on Logout
   */
  async logoutSession(refreshToken?: string) {
    if (!refreshToken) return;
    try {
      const decoded = jwt.verify(
        refreshToken,
        ENV.JWT_REFRESH_SECRET || "refresh_secret_fallback",
      ) as { userId: string; tokenId: string };

      const redisKey = `refresh_token:${decoded.userId}:${decoded.tokenId}`;
      await redisClient.del(redisKey);
    } catch {
      // Token already invalid or expired
    }
  }

  /**
   * Helper: Issue Access + Refresh Token Pair and store in Redis
   */
  private async issueTokenPair(userId: string, email: string) {
    const tokenId = crypto.randomUUID();

    const accessToken = jwt.sign(
      { userId, email },
      ENV.JWT_ACCESS_SECRET || "access_secret_fallback",
      { expiresIn: ACCESS_TOKEN_EXPIRY },
    );

    const refreshToken = jwt.sign(
      { userId, email, tokenId },
      ENV.JWT_REFRESH_SECRET || "refresh_secret_fallback",
      { expiresIn: `${REFRESH_TOKEN_EXPIRY_SECONDS}s` },
    );

    const redisKey = `refresh_token:${userId}:${tokenId}`;
    await redisClient.set(
      redisKey,
      refreshToken,
      "EX",
      REFRESH_TOKEN_EXPIRY_SECONDS,
    );

    return { accessToken, refreshToken };
  }

  private async revokeAllUserSessions(userId: string) {
    const keys = await redisClient.keys(`refresh_token:${userId}:*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
}

export const authService = new AuthService();