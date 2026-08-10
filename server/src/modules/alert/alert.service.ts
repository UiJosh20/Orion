import pgPool from "../../config/db.js";
import { redisClient } from "../../config/redis.js";

export interface CreateAlertDto {
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT';
  thresholdValue: number;
}

export class AlertService {
  /**
   * Register a new user price or indicator alert
   */
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

  /**
   * Fetch all active alerts that haven't been triggered yet
   */
  public static async getActiveAlerts() {
    const query = `SELECT * FROM user_alerts WHERE is_active = TRUE AND is_triggered = FALSE;`;
    const result = await pgPool.query(query);
    return result.rows;
  }

  /**
   * Mark an alert as triggered so it doesn't spam notifications
   */
  public static async markAlertAsTriggered(alertId: number) {
    const query = `UPDATE user_alerts SET is_triggered = TRUE, is_active = FALSE WHERE id = $1;`;
    await pgPool.query(query, [alertId]);
  }
}



export class AlertWorkerService {
  private static workerInterval: NodeJS.Timeout | null = null;

  /**
   * Start the background alert monitoring loop
   * @param intervalMs Frequency to check alerts (default: 10 seconds)
   */
  public static startAlertEngine(intervalMs: number = 10000) {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
    }

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

      for (const alert of activeAlerts) {
        const formattedSymbol = alert.symbol.replace('/', '').toUpperCase();
        // Assume 1h interval or match stored asset interval
        const redisKey = `orion:live:${formattedSymbol}:1h`;
        const cachedMarketDataString = await redisClient.get(redisKey);

        if (!cachedMarketDataString) continue;

        const marketData = JSON.parse(cachedMarketDataString);
        const currentPrice = marketData.latestPrice || marketData.closePrice;

        if (!currentPrice) continue;

        let conditionMet = false;

        // Evaluate user alert conditions
        if (alert.condition === 'ABOVE' && currentPrice >= parseFloat(alert.threshold_value)) {
          conditionMet = true;
        } else if (alert.condition === 'BELOW' && currentPrice <= parseFloat(alert.threshold_value)) {
          conditionMet = true;
        }

        if (conditionMet) {
          console.warn(
            `[🚨 ALERT TRIGGERED]: User ${alert.user_id} -> ${alert.symbol} hit target price ${currentPrice} (${alert.condition} ${alert.threshold_value})`
          );

          // Mark as triggered in Postgres to prevent duplicate alert notifications
          await AlertService.markAlertAsTriggered(alert.id);

          // TODO: Dispatch actual push notification, webhook, or email here
        }
      }
    } catch (error: any) {
      console.error('[Alert Engine Worker Error]:', error.message);
    }
  }
}