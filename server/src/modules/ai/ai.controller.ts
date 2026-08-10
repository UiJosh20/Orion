import { Request, Response } from 'express';
import { MarketMathService, MarketOrchestrator } from '../market/market.service.js';
import { AiInsightService } from './ai.service.js';


export const getAiMarketInsight = async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTCUSDT';
    const interval = (req.query.interval as string) || '1h';

    // 1. Fetch live or cached data via your orchestrator
    const marketData = await MarketOrchestrator.getDynamicMarketData(symbol, interval);

    // Defensive check: ensure candles exist and form an array
    if (!marketData || !marketData.candles || !Array.isArray(marketData.candles) || marketData.candles.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `No candle data could be retrieved for symbol: ${symbol}. Please verify the ticker symbol.`,
      });
    }

    const closingPrices = marketData.candles.map((c: any) => c.close);

    // 2. Compute indicators
    const rsiValues = MarketMathService.calculateRSI(closingPrices) || [];
    const smaValues = MarketMathService.calculateSMA(closingPrices, 20) || [];

    const currentRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
    const currentSma = smaValues.length > 0 ? smaValues[smaValues.length - 1] : null;

    // 3. Generate AI report
    const insightReport = await AiInsightService.generateMarketInsight({
      symbol: marketData.symbol,
      interval: marketData.interval,
      assetType: marketData.assetType,
      latestPrice: marketData.latestPrice,
      rsi: currentRsi,
      sma: currentSma,
    });

    return res.status(200).json({
      status: 'success',
      symbol: marketData.symbol,
      interval: marketData.interval,
      indicators: {
        rsi: currentRsi,
        sma: currentSma,
      },
      aiInsight: insightReport,
    });
  } catch (error: any) {
    console.error('[AI Controller Error]:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to generate AI insight report.',
    });
  }
};