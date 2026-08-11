import { Request, Response } from 'express';
import { sessionService } from './session.service.js';


  async function registerDeviceSession(req: Request, res: Response) {
    try {
      const deviceUuid = req.body.deviceUuid || (req.headers['x-device-uuid'] as string);

      if (!deviceUuid) {
        return res.status(400).json({ error: 'deviceUuid is required' });
      }

      const session = await sessionService.upsertDeviceSession(deviceUuid);

      return res.status(200).json({
        message: 'Anonymous device session synced successfully',
        session,
      });
    } catch (error: any) {
      console.error('[SessionController Error]:', error.message);
      return res.status(500).json({ error: 'Failed to sync device session' });
    }
  }

  export { registerDeviceSession };
