// ai.controller.ts
import { Request, Response } from 'express';
import { MarketMathService, MarketOrchestrator } from '../market/market.service.js';
import { AiInsightService } from './ai.service.js';

export const getAiMarketInsight = async (req: Request, res: Response) => {
  try {
    const symbol = ((req.query.symbol as string) || 'BTCUSDT').trim().toUpperCase();
    const interval = ((req.query.interval as string) || '1h').trim();
    const parsedRisk = req.query.riskPercent ? Number(req.query.riskPercent) : 1.0;
    const parsedRR = req.query.riskRewardRatio ? Number(req.query.riskRewardRatio) : 2.0;

    const riskPercent = isNaN(parsedRisk) ? 1.0 : parsedRisk;
    const riskRewardRatio = isNaN(parsedRR) ? 2.0 : parsedRR;

    const marketData = await MarketOrchestrator.getDynamicMarketData(symbol, interval);

    if (!marketData || !marketData.candles || !Array.isArray(marketData.candles) || marketData.candles.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `No candle data could be retrieved for symbol: ${symbol}. Please verify the ticker symbol.`,
      });
    }

    // 1. Fetch comprehensive quantitative & structural telemetry in one call
    const telemetry = MarketMathService.getComprehensiveTelemetry(marketData.candles);

    // 2. Calculate 24h volume change percentage
    let volume24hChangePct: number | null = null;
    if (marketData.candles.length >= 25) {
      const recentVol = marketData.candles.slice(-24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
      const priorVol = marketData.candles.slice(-48, -24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
      if (priorVol > 0) {
        volume24hChangePct = Number((((recentVol - priorVol) / priorVol) * 100).toFixed(2));
      }
    }

    // 3. Generate AI insight with complete context (Chop, Volatility, VWAP, News & Structural Levels)
    const insightReport = await AiInsightService.generateMarketInsight({
      symbol: marketData.symbol,
      interval: marketData.interval,
      assetType: marketData.assetType,
      latestPrice: marketData.latestPrice,
      rsi: telemetry.rsi,
      sma: telemetry.sma,
      atr: telemetry.atr,
      adx: telemetry.adx?.adx || null,
      pdi: telemetry.adx?.pdi || null,
      mdi: telemetry.adx?.mdi || null,
      vwap: telemetry.vwap || null,
      bollingerBands: telemetry.bollingerBands,
      recentSwingHigh: telemetry.swingRange.swingHigh,
      recentSwingLow: telemetry.swingRange.swingLow,
      volume24hChangePct,
      newsHeadlines: marketData.headlines || [],
      fundingRate: null, // Reserved for futures API integration
      riskPercent,
      riskRewardRatio,
    });

    return res.status(200).json({
      status: 'success',
      symbol: marketData.symbol,
      interval: marketData.interval,
      assetType: marketData.assetType,
      latestPrice: marketData.latestPrice,
      indicators: telemetry,
      volume24hChangePct,
      aiInsight: insightReport,
      lastUpdated: marketData.lastUpdated,
    });
  } catch (error: any) {
    console.error('[AI Controller Error]:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to generate AI insight report.',
    });
  }
};