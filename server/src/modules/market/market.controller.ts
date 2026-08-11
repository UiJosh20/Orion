import { Request, Response } from 'express';
import { MarketMathService, MarketOrchestrator, MarketWatchList } from './market.service.js';


export const getTechnicalAnalysis = async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTCUSDT';
    const interval = (req.query.interval as string) || '1h';

    // Fetch data dynamically through the orchestrator (Redis + Auto-Background Tracking)
    const marketData = await MarketOrchestrator.getDynamicMarketData(symbol, interval);
    // console.log(marketData, "marketData")

    // Defensive check: ensure candles exist and form an array
    if (!marketData || !marketData.candles || !Array.isArray(marketData.candles) || marketData.candles.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `No candle data could be retrieved for symbol: ${symbol}. Please check if the ticker symbol is valid or if external rate limits were reached.`,
      });
    }

    const closingPrices = marketData.candles.map((c: any) => c.close);

    // Compute technical indicators
    const rsiValues = MarketMathService.calculateRSI(closingPrices) || [];
    const smaValues = MarketMathService.calculateSMA(closingPrices, 20) || [];

    return res.status(200).json({
      status: 'success',
      source: 'dynamic-cache-orchestrator',
      assetType: marketData.assetType,
      symbol: marketData.symbol,
      interval: marketData.interval,
      latestPrice: marketData.latestPrice,
      indicators: {
        rsi: rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null,
        sma: smaValues.length > 0 ? smaValues[smaValues.length - 1] : null,
      },
      candles: marketData.candles,
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
    return res.json(data);
  } catch (error) {
    console.error('Error in getSymbols:', error);
    return res.status(500).json({ error: 'Failed to fetch symbols' });
  }
};

export const getWatchlist = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const watchlist = await MarketWatchList.getUserWatchlist(userId as any);
    return res.json({ watchlist });
  } catch (error) {
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

    const result = await MarketWatchList.addToWatchlist(userId, symbol);
    return res.status(201).json({ message: 'Added to watchlist', data: result });
  } catch (error) {
    console.error('Error in addToWatchlist:', error);
    return res.status(500).json({ error: 'Failed to add to watchlist' });
  }
};