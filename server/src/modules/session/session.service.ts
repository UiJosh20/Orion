import pgPool from '../../config/db.js';

export class SessionService {
  /**
   * Upsert anonymous device session into database
   */
  async upsertDeviceSession(deviceUuid: string) {
    const query = `
      INSERT INTO anonymous_sessions (device_uuid, last_active_at)
      VALUES ($1, NOW())
      ON CONFLICT (device_uuid)
      DO UPDATE SET last_active_at = NOW()
      RETURNING id, device_uuid, created_at, last_active_at;
    `;

    const { rows } = await pgPool.query(query, [deviceUuid]);
    return rows[0];
  }
}

export const sessionService = new SessionService();