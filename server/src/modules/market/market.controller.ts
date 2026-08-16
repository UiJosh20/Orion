// market.controller.ts
import { Request, Response } from 'express';
import { MarketMathService, MarketOrchestrator, MarketWatchList } from './market.service.js';
import pgPool from '../../config/db.js';

export const getTechnicalAnalysis = async (req: Request, res: Response) => {
  try {
    const symbol = ((req.query.symbol as string) || 'BTCUSDT').trim().toUpperCase();
    const interval = ((req.query.interval as string) || '1h').trim();

    const marketData = await MarketOrchestrator.getDynamicMarketData(symbol, interval);

    if (!marketData || !marketData.candles || !Array.isArray(marketData.candles) || marketData.candles.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `No candle data could be retrieved for symbol: ${symbol}.`,
      });
    }

    // Generate complete strategy telemetry (RSI, SMA, ATR, ADX, VWAP, Bollinger Bands, Swing Range)
    const indicators = MarketMathService.getComprehensiveTelemetry(marketData.candles);

    return res.status(200).json({
      status: 'success',
      source: 'dynamic-cache-orchestrator',
      assetType: marketData.assetType,
      symbol: marketData.symbol,
      interval: marketData.interval,
      latestPrice: marketData.latestPrice,
      indicators,
      headlines: marketData.headlines || [],
      candles: marketData.candles,
      lastUpdated: marketData.lastUpdated,
    });
  } catch (error: any) {
    console.error('[Market Analysis Error]:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to calculate market technical indicators.',
    });
  }
};

export const getSymbols = async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    const data = await MarketWatchList.getSupportedSymbols(category as string);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Error in getSymbols:', error);
    return res.status(500).json({ error: 'Failed to fetch symbols' });
  }
};

export const getWatchlist = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId parameter is required' });
    }

    const watchlist = await MarketWatchList.getUserWatchlist(userId);
    return res.status(200).json({ watchlist });
  } catch (error: any) {
    console.error('Error in getWatchlist:', error);
    return res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
};

export const addToWatchlist = async (req: Request, res: Response) => {
  try {
    const { userId, symbol } = req.body;
    if (!userId || !symbol) {
      return res.status(400).json({ error: 'userId and symbol are required' });
    }

    const result = await MarketWatchList.addToWatchlist(userId, symbol.trim().toUpperCase());
    return res.status(201).json({ message: 'Added to watchlist', data: result });
  } catch (error: any) {
    console.error('Error in addToWatchlist:', error);
    return res.status(500).json({ error: 'Failed to add to watchlist' });
  }
};


// Add this to the bottom of market.controller.ts

export const saveUserPosition = async (req: Request, res: Response) => {
  try {
    const { userId, symbol, interval, side, entry, target, stopLoss, time, createdAt } = req.body;

    if (!userId || !symbol || !side || entry == null || target == null || stopLoss == null) {
      return res.status(400).json({ error: 'Missing required fields (userId, symbol, side, entry, target, stopLoss)' });
    }

    // Insert into the database
    const query = `
      INSERT INTO user_positions (user_id, symbol, interval, side, entry, target, stop_loss, time, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    
    const values = [
      userId,
      symbol.trim().toUpperCase(),
      interval,
      side,
      entry,
      target,
      stopLoss,
      time ? new Date(time * 1000) : new Date(),
      createdAt ? new Date(createdAt * 1000) : new Date()
    ];

    const { rows } = await pgPool.query(query, values);
    
    return res.status(201).json({ 
      status: 'success', 
      message: 'Position saved successfully',
      data: rows[0] 
    });
  } catch (error: any) {
    console.error('[Save Position Error]:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: error.message || 'Failed to save position' 
    });
  }
};

export const getUserPositions = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { symbol } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId parameter is required' });
    }

    let query = `
      SELECT id, user_id, symbol, interval, side, entry, target, stop_loss as "stopLoss", time, created_at as "createdAt"
      FROM user_positions
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (symbol) {
      query += ` AND symbol = $2`;
      params.push(symbol.toString().trim().toUpperCase());
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pgPool.query(query, params);
    
    return res.status(200).json(rows);
  } catch (error: any) {
    console.error('[Get User Positions Error]:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: error.message || 'Failed to fetch user positions' 
    });
  }
};

export const deleteUserPosition = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId } = req.body; // Optional: verify user owns this position

    if (!id) {
      return res.status(400).json({ error: 'Position ID is required' });
    }

    let query = 'DELETE FROM user_positions WHERE id = $1';
    const params: any[] = [id];

    if (userId) {
      query += ' AND user_id = $2';
      params.push(userId);
    }

    query += ' RETURNING *';

    const { rows } = await pgPool.query(query, params);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Position not found or you do not have permission to delete it' });
    }

    return res.status(200).json({ 
      status: 'success', 
      message: 'Position deleted successfully' 
    });
  } catch (error: any) {
    console.error('[Delete Position Error]:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: error.message || 'Failed to delete position' 
    });
  }
};


export const updateUserPosition = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, symbol, interval, side, entry, target, stopLoss, time, createdAt } = req.body;

    console.log(`[Backend] Received Update Request - ID: ${id}, UserID: ${userId}`);

    // ✅ FIX: Explicitly check if ID is "undefined" or null
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ 
        error: 'Invalid ID provided. The position cannot be updated because the UUID is missing or undefined.' 
      });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // ✅ 1. First, check if this position actually exists!
    const checkQuery = `SELECT id FROM user_positions WHERE id = $1 AND user_id = $2`;
    const checkResult = await pgPool.query(checkQuery, [id, userId]);

    if (checkResult.rows.length === 0) {
      console.error(`[Backend] ERROR: Position ${id} not found for user ${userId}`);
      return res.status(404).json({ 
        error: 'Position not found in database. The ID is invalid or belongs to a different user.' 
      });
    }

    // ✅ 2. Update the position
    const updateQuery = `
      UPDATE user_positions 
      SET symbol = $1, interval = $2, side = $3, entry = $4, target = $5, stop_loss = $6, time = $7, created_at = $8
      WHERE id = $9 AND user_id = $10
      RETURNING *;
    `;

    const values = [
      symbol.trim().toUpperCase(),
      interval,
      side,
      Number(entry),
      Number(target),
      Number(stopLoss),
      time ? new Date(time * 1000) : new Date(),
      createdAt ? new Date(createdAt * 1000) : new Date(),
      id,
      userId
    ];

    const { rows } = await pgPool.query(updateQuery, values);
    
    return res.status(200).json({ 
      status: 'success', 
      message: 'Position updated successfully',
      data: rows[0] 
    });
  } catch (error: any) {
    console.error('[Update Position Error]:', error.message);
    return res.status(500).json({ 
      status: 'error', 
      message: error.message || 'Failed to update position' 
    });
  }
};


export const saveUserRiskConfig = async (req: Request, res: Response) => {
  try {
    const { userId, riskPercent, riskRewardRatio } = req.body;

    if (!userId || riskPercent == null || riskRewardRatio == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const query = `
      INSERT INTO user_risk_config (user_id, risk_percent, risk_reward_ratio, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET risk_percent = $2, risk_reward_ratio = $3, updated_at = NOW()
      RETURNING *;
    `;

    const { rows } = await pgPool.query(query, [userId, riskPercent, riskRewardRatio]);
    
    return res.status(200).json({ status: 'success', data: rows[0] });
  } catch (error: any) {
    console.error('[Save Risk Config Error]:', error);
    return res.status(500).json({ error: error.message });
  }
};