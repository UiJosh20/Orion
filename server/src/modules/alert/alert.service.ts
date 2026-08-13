// modules/alert/alert.service.ts
import pgPool from "../../config/db.js";
import { redisClient } from "../../config/redis.js";
import { Server as SocketIOServer } from 'socket.io';

export interface CreateAlertDto {
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT';
  thresholdValue: number;
}

export class AlertService {
  public static async createAlert(data: CreateAlertDto) {
    const query = `
      INSERT INTO user_alerts (user_id, symbol, condition, threshold_value, is_active, is_triggered)
      VALUES ($1, $2, $3, $4, TRUE, FALSE)
      RETURNING *;
    `;
    const values = [data.userId, data.symbol.toUpperCase(), data.condition, data.thresholdValue];
    const result = await pgPool.query(query, values);
    return result.rows[0];
  }

  public static async getActiveAlerts() {
    const query = `SELECT * FROM user_alerts WHERE is_active = TRUE AND is_triggered = FALSE;`;
    const result = await pgPool.query(query);
    return result.rows;
  }

  public static async markAlertAsTriggered(alertId: number) {
    const query = `UPDATE user_alerts SET is_triggered = TRUE, is_active = FALSE WHERE id = $1;`;
    await pgPool.query(query, [alertId]);
  }
}

export class AlertWorkerService {
  private static workerInterval: NodeJS.Timeout | null = null;
  private static io: SocketIOServer | null = null;

  public static startAlertEngine(ioInstance: SocketIOServer, intervalMs: number = 10000) {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
    }

    this.io = ioInstance;
    console.log(`[Alert Engine]: Background monitoring worker initialized (Running every ${intervalMs / 1000}s)`);

    this.workerInterval = setInterval(async () => {
      await this.evaluateAlerts();
    }, intervalMs);
  }

  public static stopAlertEngine() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
      console.log('[Alert Engine]: Background monitoring stopped.');
    }
  }

  private static async evaluateAlerts() {
    try {
      const activeAlerts = await AlertService.getActiveAlerts();
      if (activeAlerts.length === 0) return;

      console.log(`[Alert Engine]: Checking ${activeAlerts.length} active alerts...`);

      for (const alert of activeAlerts) {
        const formattedSymbol = alert.symbol.replace('/', '').toUpperCase();
        const redisKey = `orion:live:${formattedSymbol}:1h`;
        const cachedMarketDataString = await redisClient.get(redisKey);

        if (!cachedMarketDataString) {
          console.log(`[Alert Engine]: No market data for ${formattedSymbol}`);
          continue;
        }

        const marketData = JSON.parse(cachedMarketDataString);
        const currentPrice = marketData.latestPrice || marketData.closePrice;

        if (!currentPrice) {
          console.log(`[Alert Engine]: No price data for ${formattedSymbol}`);
          continue;
        }

        let conditionMet = false;

        // Evaluate user alert conditions
        if (alert.condition === 'ABOVE' && currentPrice >= parseFloat(alert.threshold_value)) {
          conditionMet = true;
        } else if (alert.condition === 'BELOW' && currentPrice <= parseFloat(alert.threshold_value)) {
          conditionMet = true;
        } else if (alert.condition === 'RSI_OVERSOLD' && currentPrice <= parseFloat(alert.threshold_value)) {
          conditionMet = true;
        } else if (alert.condition === 'RSI_OVERBOUGHT' && currentPrice >= parseFloat(alert.threshold_value)) {
          conditionMet = true;
        }

        if (conditionMet) {
          console.warn(
            `[🚨 ALERT TRIGGERED]: User ${alert.user_id} -> ${alert.symbol} hit target price ${currentPrice} (${alert.condition} ${alert.threshold_value})`
          );

          // Mark as triggered in Postgres to prevent duplicate alert notifications
          await AlertService.markAlertAsTriggered(alert.id);

          // Dispatch live WebSocket event to the specific user's room
          if (this.io) {
            const alertPayload = {
              id: alert.id,
              symbol: alert.symbol,
              price: currentPrice,
              condition: alert.condition,
              threshold: parseFloat(alert.threshold_value),
              timestamp: new Date().toISOString(),
            };
            
            // IMPORTANT: Use the exact same room name format as the frontend
            const roomName = `user:${alert.user_id}`;
            
            console.log(`[Alert Engine]: Emitting alert to room: ${roomName}`, alertPayload);
            
            // Emit to user's room
            this.io.to(roomName).emit('alert_triggered', alertPayload);
            
            // Also emit globally for debugging
            this.io.emit('alert_triggered_global', alertPayload);
          }
        }
      }
    } catch (error: any) {
      console.error('[Alert Engine Worker Error]:', error.message);
    }
  }
}