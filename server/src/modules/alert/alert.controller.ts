import { Request, Response } from 'express';
import { AlertService } from './alert.service.js';

export const createAlertController = async (req: Request, res: Response) => {
  try {
    const { userId, symbol, condition, thresholdValue } = req.body;

    if (!userId || !symbol || !condition || thresholdValue === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: userId, symbol, condition, and thresholdValue are required.',
      });
    }

    const validConditions = ['ABOVE', 'BELOW', 'RSI_OVERSOLD', 'RSI_OVERBOUGHT'];
    if (!validConditions.includes(condition)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid condition. Must be one of: ${validConditions.join(', ')}`,
      });
    }

    const newAlert = await AlertService.createAlert({
      userId,
      symbol,
      condition,
      thresholdValue,
    });

    return res.status(201).json({
      status: 'success',
      message: 'Price alert successfully registered.',
      data: newAlert,
    });
  } catch (error: any) {
    console.error('[Create Alert Error]:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to create alert.',
    });
  }
};

export const getActiveAlertsController = async (req: Request, res: Response) => {
  try {
    const alerts = await AlertService.getActiveAlerts();
    return res.status(200).json({
      status: 'success',
      count: alerts.length,
      data: alerts,
    });
  } catch (error: any) {
    console.error('[Fetch Alerts Error]:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve active alerts.',
    });
  }
};