import { Request, Response } from 'express';
import { MarketMathService, MarketOrchestrator } from '../market/market.service.js';
import { AiInsightService } from './ai.service.js';

export const getAiMarketInsight = async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTCUSDT';
    const interval = (req.query.interval as string) || '1h';
    const riskPercent = req.query.riskPercent ? Number(req.query.riskPercent) : 1.0;
    const riskRewardRatio = req.query.riskRewardRatio ? Number(req.query.riskRewardRatio) : 2.0;

    const marketData = await MarketOrchestrator.getDynamicMarketData(symbol, interval);

    if (!marketData || !marketData.candles || !Array.isArray(marketData.candles) || marketData.candles.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `No candle data could be retrieved for symbol: ${symbol}. Please verify the ticker symbol.`,
      });
    }

    const closingPrices = marketData.candles.map((c: any) => c.close);

    // Indicators
    const rsiValues = MarketMathService.calculateRSI(closingPrices) || [];
    const smaValues = MarketMathService.calculateSMA(closingPrices, 20) || [];
    const currentRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
    const currentSma = smaValues.length > 0 ? smaValues[smaValues.length - 1] : null;

    // Structural context — this is what was missing before. Without this,
    // the AI has no real support/resistance to check its own claims against.
    const atr = MarketMathService.calculateATR(marketData.candles);
    const { swingHigh, swingLow } = MarketMathService.findRecentSwingRange(marketData.candles, 50);

    // 24h volume change, if you're tracking volume on candles
    let volume24hChangePct: number | null = null;
    if (marketData.candles.length >= 25) {
      const recentVol = marketData.candles.slice(-24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
      const priorVol = marketData.candles.slice(-48, -24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
      if (priorVol > 0) {
        volume24hChangePct = Number((((recentVol - priorVol) / priorVol) * 100).toFixed(2));
      }
    }

    const insightReport = await AiInsightService.generateMarketInsight({
      symbol: marketData.symbol,
      interval: marketData.interval,
      assetType: marketData.assetType,
      latestPrice: marketData.latestPrice,
      rsi: currentRsi,
      sma: currentSma,
      newsHeadlines: marketData.headlines || [],
      atr,
      recentSwingHigh: swingHigh,
      recentSwingLow: swingLow,
      volume24hChangePct,
      fundingRate: null, // wire this up if/when you pull funding rate from Binance
      riskPercent,
      riskRewardRatio,
    });

    return res.status(200).json({
      status: 'success',
      symbol: marketData.symbol,
      interval: marketData.interval,
      indicators: { rsi: currentRsi, sma: currentSma, atr, swingHigh, swingLow },
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