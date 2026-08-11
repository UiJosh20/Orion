import { Request, Response, NextFunction } from 'express';
import pgPool from '../config/db.js';

export async function deviceSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const deviceUuid = req.headers['x-device-uuid'] as string;

  if (deviceUuid) {
    try {
      // Upsert into anonymous_sessions: Insert if new, or update last_active_at if existing
      const query = `
        INSERT INTO anonymous_sessions (device_uuid, last_active_at)
        VALUES ($1, NOW())
        ON CONFLICT (device_uuid) 
        DO UPDATE SET last_active_at = NOW();
      `;
      await pgPool.query(query, [deviceUuid]);
    } catch (error) {
      console.error('[Device Session Middleware Error]:', error);
      // Continue execution so user requests are not blocked if tracking fails
    }
  }

  next();
}