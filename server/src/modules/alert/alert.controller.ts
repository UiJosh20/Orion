import { Request, Response } from 'express';
import { AlertService } from './alert.service.js';
import { io } from '../../server.js';

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


//test
export const testAlertController = async (req: Request, res: Response) => {
  try {
    const { userId, symbol, price, condition, threshold } = req.body;
    
    console.log('[Test Alert]: Request body:', req.body);
    
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'userId is required',
      });
    }
    
    // Validate and parse values
    const parsedPrice = parseFloat(price);
    const parsedThreshold = parseFloat(threshold);
    
    if (isNaN(parsedPrice) || isNaN(parsedThreshold)) {
      return res.status(400).json({
        status: 'error',
        message: 'price and threshold must be valid numbers',
      });
    }
    
    // Emit a test alert
    const alertPayload = {
      id: 'test-' + Date.now(),
      symbol: symbol || 'BTCUSDT',
      price: parsedPrice,
      condition: condition || 'ABOVE',
      threshold: parsedThreshold,
      timestamp: new Date().toISOString(),
    };
    
    const roomName = `user:${userId}`;
    
    console.log(`[Test Alert]: Emitting to room: ${roomName}`, alertPayload);
    
    // Check if io is available
    if (!io) {
      return res.status(500).json({
        status: 'error',
        message: 'Socket.io not initialized',
      });
    }
    
    // Emit to user's room
    io.to(roomName).emit('alert_triggered', alertPayload);
    
    // Also emit globally for debugging
    io.emit('alert_triggered_global', alertPayload);
    
    return res.status(200).json({
      status: 'success',
      message: 'Test alert sent',
      data: alertPayload,
      room: roomName,
    });
  } catch (error: any) {
    console.error('[Test Alert Error]:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};