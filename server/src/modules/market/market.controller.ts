// market.controller.ts
import { Request, Response } from 'express';
import { MarketMathService, MarketOrchestrator, MarketWatchList } from './market.service.js';

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