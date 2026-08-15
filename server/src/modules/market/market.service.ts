import { RSI, SMA, ADX, BollingerBands } from "technicalindicators";
import { ENV } from "../../config/env.js";
import axios from "axios";
import WebSocket from "ws";
import { redisClient } from "../../config/redis.js";
import { NewsService } from "../news/news.service.js";
import pgPool from "../../config/db.js";

// ============================================
// TYPES & INTERFACES
// ============================================

export interface Candle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketDataPayload {
  symbol: string;
  interval: string;
  assetType: "crypto" | "index" | "forex";
  latestPrice: number;
  candles: Candle[];
  headlines?: any[];
  lastUpdated: string;
}

export interface IndicatorTelemetry {
  rsi: number | null;
  sma: number | null;
  atr: number | null;
  adx: { adx: number; pdi: number; mdi: number } | null;
  vwap: number | null;
  bollingerBands: { upper: number; middle: number; lower: number; bandwidthPct: number } | null;
  swingRange: { swingHigh: number | null; swingLow: number | null };
}

interface WebSocketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isFinal: boolean;
}

export interface IForexProvider {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  getProviderName(): string;
}

// ============================================
// MARKET SERVICE - CRYPTO, INDICES & FOREX
// ============================================

export class MarketService {
  private static cache: Map<string, { candles: Candle[]; timestamp: number }> = new Map();
  private static CACHE_TTL = 30000; // 30 seconds
  private static forexProvider: IForexProvider | null = null;
  private static isBinanceAvailable = true;
  private static lastBinanceCheck = 0;
  private static BINANCE_CHECK_INTERVAL = 30000;

  public static registerForexProvider(provider: IForexProvider): void {
    this.forexProvider = provider;
    console.log(`[MarketService] Forex provider registered: ${provider.getProviderName()}`);
  }

  /**
   * Helper to parse and sanitize standard symbols (e.g., "BTC/USDT" or "BTCUSDT") into base & quote components.
   */
  private static parseSymbol(rawSymbol: string): { base: string; quote: string; clean: string } {
    const clean = rawSymbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (clean.endsWith("USDT")) return { base: clean.slice(0, -4), quote: "USDT", clean };
    if (clean.endsWith("USDC")) return { base: clean.slice(0, -4), quote: "USDC", clean };
    if (clean.endsWith("BUSD")) return { base: clean.slice(0, -4), quote: "BUSD", clean };
    if (clean.endsWith("USD")) return { base: clean.slice(0, -3), quote: "USD", clean };
    if (clean.endsWith("BTC")) return { base: clean.slice(0, -3), quote: "BTC", clean };
    return { base: clean.slice(0, 3), quote: clean.slice(3), clean };
  }

  /**
   * Main entry point - routes to Crypto, Index, or Forex providers
   */
  public static async getCandles(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 50
  ): Promise<Candle[]> {
    const formattedSymbol = symbol.trim().toUpperCase();
    const cacheKey = `${formattedSymbol}:${interval}:${limit}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.candles;
    }

    let candles: Candle[] = [];

    try {
      if (this.isIndexSymbol(formattedSymbol)) {
        candles = await this.fetchYahooFinanceIndex(formattedSymbol, interval, limit);
      } else if (this.isCryptoSymbol(formattedSymbol)) {
        candles = await this.fetchCryptoData(formattedSymbol, interval, limit);
      } else {
        if (this.forexProvider) {
          candles = await this.forexProvider.getCandles(formattedSymbol, interval, limit);
        } else {
          candles = await this.fetchYahooFinanceIndex(formattedSymbol, interval, limit);
        }
      }
    } catch (error: any) {
      console.error(`[MarketService] Error fetching ${formattedSymbol}:`, error.message);
      candles = [];
    }

    if (!candles || candles.length === 0) {
      console.warn(`[MarketService] No data available for ${formattedSymbol}`);
      return [];
    }

    this.cache.set(cacheKey, { candles, timestamp: Date.now() });
    return candles;
  }

  public static isCryptoSymbol(symbol: string): boolean {
    const cleanSymbol = symbol.replace("/", "").toUpperCase();
    const cryptoQuotes = ["USDT", "BTC", "ETH", "BNB", "BUSD", "USDC", "DAI", "TUSD"];
    const isIndex = this.isIndexSymbol(cleanSymbol);
    if (isIndex) return false;

    return (
      cryptoQuotes.some((q) => cleanSymbol.endsWith(q)) ||
      cleanSymbol.includes("USDT") ||
      cleanSymbol.includes("BTC") ||
      (cleanSymbol.length >= 6 && !cleanSymbol.startsWith("^"))
    );
  }

  public static isIndexSymbol(symbol: string): boolean {
    const cleanSymbol = symbol.replace("/", "").toUpperCase();
    const indexSymbols = [
      "NAS100", "US100", "NASDAQ", "QQQ", "^NDX",
      "US500", "SP500", "SPX", "SPY", "^GSPC",
      "US30", "DOW", "DJI", "DIA", "^DJI",
      "DXY", "DX-Y.NYB", "UUP", "VIX", "^VIX"
    ];
    return indexSymbols.includes(cleanSymbol);
  }

  /**
   * FREE INDEX PROVIDER: Yahoo Finance Engine
   */
  private static async fetchYahooFinanceIndex(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const cleanSymbol = symbol.replace("/", "").toUpperCase();
    const symbolMap: Record<string, string> = {
      NAS100: "^NDX",
      US100: "^NDX",
      NASDAQ: "^NDX",
      QQQ: "QQQ",
      US500: "^GSPC",
      SP500: "^GSPC",
      SPX: "^GSPC",
      SPY: "SPY",
      US30: "^DJI",
      DOW: "^DJI",
      DIA: "DIA",
      DXY: "DX-Y.NYB",
      VIX: "^VIX",
    };

    const yahooSymbol = symbolMap[cleanSymbol] || cleanSymbol;
    const intervalMap: Record<string, string> = {
      "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
      "1h": "1h", "2h": "1h", "4h": "1h", "1d": "1d", "1w": "1wk", "1M": "1mo"
    };

    const yahooInterval = intervalMap[interval] || "1h";

    try {
      console.log(`[YahooFinance] Fetching index ${yahooSymbol} (${yahooInterval})...`);

      const response = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`,
        {
          params: {
            range: "7d",
            interval: yahooInterval,
          },
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          timeout: 4000,
        }
      );

      const result = response.data?.chart?.result?.[0];
      if (!result) throw new Error("Invalid structure from Yahoo Finance");

      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const closes = quote.close || [];
      const volumes = quote.volume || [];

      const candles: Candle[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] !== null && closes[i] !== undefined) {
          candles.push({
            datetime: new Date(timestamps[i] * 1000).toISOString(),
            open: Number((opens[i] ?? closes[i]).toFixed(2)),
            high: Number((highs[i] ?? closes[i]).toFixed(2)),
            low: Number((lows[i] ?? closes[i]).toFixed(2)),
            close: Number(closes[i].toFixed(2)),
            volume: Number(volumes[i] ?? 0),
          });
        }
      }

      console.log(`[YahooFinance] Fetched ${candles.length} candles for ${symbol}`);
      return candles.slice(-limit);
    } catch (error: any) {
      throw new Error(`Yahoo Finance failed for ${symbol}: ${error.message}`);
    }
  }

  /**
   * CRYPTO MULTI-PROVIDER ENGINE (CLOUD-SAFE AND RESILIENT)
   */
  private static async fetchCryptoData(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const providers = [
      { name: "BinanceVision", fn: () => this.fetchBinanceVisionCrypto(symbol, interval, limit) },
      { name: "Bybit", fn: () => this.fetchBybitCrypto(symbol, interval, limit) },
      { name: "CryptoCompare", fn: () => this.fetchCryptoCompareCrypto(symbol, interval, limit) },
      { name: "BinancePublic", fn: () => this.fetchBinanceCrypto(symbol, interval, limit) },
      { name: "Kraken", fn: () => this.fetchKrakenCrypto(symbol, interval, limit) },
      { name: "Bitfinex", fn: () => this.fetchBitfinexCrypto(symbol, interval, limit) },
    ];

    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        console.log(`[MarketService] Trying ${provider.name} for ${symbol}...`);
        const candles = await provider.fn();
        if (candles && candles.length > 0) {
          return candles;
        }
      } catch (error: any) {
        lastError = error;
        console.warn(`[${provider.name}] Failed: ${error.message}`);
        continue;
      }
    }

    throw new Error(`All providers failed for ${symbol}: ${lastError?.message || "Unknown error"}`);
  }

  /** Provider 1: Binance Vision API (Cloud Unblocked Public Data Mirror) */
  private static async fetchBinanceVisionCrypto(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const { clean } = this.parseSymbol(symbol);
    const binanceInterval = this.BINANCE_INTERVAL_MAP[interval] || "1h";

    const response = await axios.get("https://data-api.binance.vision/api/v3/klines", {
      params: { symbol: clean, interval: binanceInterval, limit: Math.min(limit, 500) },
      timeout: 3500,
    });

    return response.data.map((kline: any[]) => ({
      datetime: new Date(kline[0]).toISOString(),
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));
  }

  /** Provider 2: Bybit V5 Public Spot REST API */
  private static async fetchBybitCrypto(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const { clean } = this.parseSymbol(symbol);
    const bybitIntervalMap: Record<string, string> = {
      "1m": "1", "5m": "5", "15m": "15", "30m": "30",
      "1h": "60", "2h": "120", "4h": "240", "6h": "360", "1d": "D", "1w": "W"
    };
    const bybitInterval = bybitIntervalMap[interval] || "60";

    const response = await axios.get("https://api.bybit.com/v5/market/kline", {
      params: { category: "spot", symbol: clean, interval: bybitInterval, limit: Math.min(limit, 200) },
      timeout: 3500,
    });

    const list = response.data?.result?.list;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("Empty response from Bybit");
    }

    // Bybit returns newest first, reverse to chronological order
    return [...list].reverse().map((d: any[]) => ({
      datetime: new Date(parseInt(d[0])).toISOString(),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }));
  }

  /** Provider 3: CryptoCompare Public API */
  private static async fetchCryptoCompareCrypto(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const { base, quote } = this.parseSymbol(symbol);
    const isMinute = ["1m", "5m", "15m", "30m"].includes(interval);
    const isDay = ["1d", "1w", "1M"].includes(interval);
    const endpointType = isMinute ? "histominute" : isDay ? "histoday" : "histohour";

    const response = await axios.get(`https://min-api.cryptocompare.com/data/v2/${endpointType}`, {
      params: { fsym: base, tsym: quote, limit: Math.min(limit, 500) },
      timeout: 3500,
    });

    if (response.data?.Response === "Error" || !response.data?.Data?.Data) {
      throw new Error(response.data?.Message || "CryptoCompare error");
    }

    return response.data.Data.Data.map((item: any) => ({
      datetime: new Date(item.time * 1000).toISOString(),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volumeto,
    }));
  }

  private static async checkBinanceAvailability(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastBinanceCheck < this.BINANCE_CHECK_INTERVAL) {
      return this.isBinanceAvailable;
    }

    try {
      const response = await axios.get("https://api.binance.com/api/v3/ping", { timeout: 2500 });
      this.isBinanceAvailable = response.status === 200;
    } catch (error) {
      this.isBinanceAvailable = false;
    }
    this.lastBinanceCheck = now;
    return this.isBinanceAvailable;
  }

  /** Normalizes a raw symbol into the USDT-quoted Binance pair form. */
  private static toBinanceSymbol(symbol: string): string {
    let binanceSymbol = symbol.replace("/", "").toUpperCase();
    if (!["USDT", "BUSD", "USDC", "BTC", "ETH"].some((q) => binanceSymbol.endsWith(q))) {
      binanceSymbol = `${binanceSymbol}USDT`;
    }
    return binanceSymbol;
  }

  private static readonly BINANCE_INTERVAL_MAP: Record<string, string> = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h", "1d": "1d",
    "1w": "1w", "1M": "1M",
  };

  private static async fetchBinanceCrypto(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const isAvailable = await this.checkBinanceAvailability();
    if (!isAvailable) throw new Error("Binance API unavailable");

    const binanceInterval = this.BINANCE_INTERVAL_MAP[interval] || "1h";
    const binanceSymbol = this.toBinanceSymbol(symbol);

    const response = await axios.get("https://api.binance.com/api/v3/klines", {
      params: { symbol: binanceSymbol, interval: binanceInterval, limit: Math.min(limit, 500) },
      timeout: 3500,
    });

    return response.data.map((kline: any[]) => ({
      datetime: new Date(kline[0]).toISOString(),
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));
  }

  private static async fetchKrakenCrypto(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const { base, quote } = this.parseSymbol(symbol);
    const krakenBase = base === "BTC" ? "XBT" : base;
    const krakenQuote = quote === "USDT" ? "USD" : quote;
    const krakenPair = `${krakenBase}${krakenQuote}`;

    const intervalMinutesMap: Record<string, number> = {
      "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440,
    };

    const response = await axios.get("https://api.kraken.com/0/public/OHLC", {
      params: { pair: krakenPair, interval: intervalMinutesMap[interval] || 60 },
      timeout: 3500,
    });

    if (response.data?.error?.length > 0) {
      throw new Error(`Kraken error: ${response.data.error.join(", ")}`);
    }

    const resultKeys = Object.keys(response.data?.result || {}).filter((k) => k !== "last");
    if (!resultKeys.length) throw new Error("Kraken empty result set");

    const ohlcData = response.data.result[resultKeys[0]];
    return ohlcData.slice(-limit).map((item: any[]) => ({
      datetime: new Date(item[0] * 1000).toISOString(),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[6]),
    }));
  }

  private static async fetchBitfinexCrypto(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const { base, quote } = this.parseSymbol(symbol);
    const bitfinexQuote = quote === "USDT" ? "UST" : quote;
    const bitfinexSymbol = `t${base}${bitfinexQuote}`;

    const response = await axios.get(`https://api-pub.bitfinex.com/v2/candles/trade:1h:${bitfinexSymbol}/hist`, {
      params: { limit: Math.min(limit, 500), sort: 1 },
      timeout: 3500,
    });

    if (!Array.isArray(response.data)) {
      throw new Error("Invalid structure from Bitfinex");
    }

    return response.data.map((item: any[]) => ({
      datetime: new Date(item[0]).toISOString(),
      open: parseFloat(item[1]),
      high: parseFloat(item[3]),
      low: parseFloat(item[4]),
      close: parseFloat(item[2]),
      volume: parseFloat(item[5]),
    }));
  }

  public static async getHistoricalKlines(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 200
  ): Promise<any[]> {
    const candles = await this.getCandles(symbol, interval, limit);
    return candles.map((c: Candle) => ({
      time: Math.floor(new Date(c.datetime).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  }

  /**
   * Fetches candles strictly older than `beforeTimeSeconds` — used for the
   * "pan back in time" pagination path on the chart.
   */
  public static async getOlderKlines(
    symbol: string,
    interval: string,
    beforeTimeSeconds: number,
    limit: number = 200
  ): Promise<Candle[]> {
    const formattedSymbol = symbol.trim().toUpperCase();
    try {
      if (this.isCryptoSymbol(formattedSymbol)) {
        return await this.fetchBinanceCryptoBefore(formattedSymbol, interval, beforeTimeSeconds, limit);
      }
      console.warn(`[MarketService] Older-history pagination not yet supported for ${formattedSymbol} (index/forex)`);
      return [];
    } catch (error: any) {
      console.error(`[MarketService] Failed to fetch older klines for ${formattedSymbol}:`, error.message);
      return [];
    }
  }

  private static async fetchBinanceCryptoBefore(
    symbol: string,
    interval: string,
    beforeTimeSeconds: number,
    limit: number
  ): Promise<Candle[]> {
    const binanceInterval = this.BINANCE_INTERVAL_MAP[interval] || "1h";
    const binanceSymbol = this.toBinanceSymbol(symbol);
    const endTimeMs = beforeTimeSeconds * 1000 - 1;

    // First try Binance Vision API (unblocked)
    try {
      const response = await axios.get("https://data-api.binance.vision/api/v3/klines", {
        params: {
          symbol: binanceSymbol,
          interval: binanceInterval,
          endTime: endTimeMs,
          limit: Math.min(limit, 500),
        },
        timeout: 4000,
      });

      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data.map((kline: any[]) => ({
          datetime: new Date(kline[0]).toISOString(),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5]),
        }));
      }
    } catch (e) {
      console.warn("[MarketService] BinanceVision fetch older klines failed, attempting standard API...");
    }

    // Fallback to standard Binance API
    const response = await axios.get("https://api.binance.com/api/v3/klines", {
      params: {
        symbol: binanceSymbol,
        interval: binanceInterval,
        endTime: endTimeMs,
        limit: Math.min(limit, 500),
      },
      timeout: 4000,
    });

    if (!Array.isArray(response.data)) {
      throw new Error("Invalid response from Binance");
    }

    return response.data.map((kline: any[]) => ({
      datetime: new Date(kline[0]).toISOString(),
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));
  }

  public static async getOlderHistoricalKlines(
    symbol: string,
    interval: string,
    beforeTimeSeconds: number,
    limit: number = 200
  ): Promise<any[]> {
    const candles = await this.getOlderKlines(symbol, interval, beforeTimeSeconds, limit);
    return candles.map((c: Candle) => ({
      time: Math.floor(new Date(c.datetime).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  }

  public static clearCache(): void {
    this.cache.clear();
  }
}

// ============================================
// MARKET MATH SERVICE (QUANT CALCULATIONS)
// ============================================

export class MarketMathService {
  public static calculateRSI(closingPrices: number[], period: number = 14): number | null {
    if (!closingPrices || closingPrices.length < period) return null;
    const results = RSI.calculate({ values: closingPrices, period });
    return results.length > 0 ? Number(results[results.length - 1].toFixed(2)) : null;
  }

  public static calculateSMA(closingPrices: number[], period: number = 20): number | null {
    if (!closingPrices || closingPrices.length < period) return null;
    const results = SMA.calculate({ values: closingPrices, period });
    return results.length > 0 ? Number(results[results.length - 1].toFixed(2)) : null;
  }

  public static calculateADX(candles: Candle[], period: number = 14): { adx: number; pdi: number; mdi: number } | null {
    if (!candles || candles.length < period * 2) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const results = ADX.calculate({ high: highs, low: lows, close: closes, period });
    if (!results || results.length === 0) return null;

    const latest = results[results.length - 1];
    return {
      adx: Number(latest.adx.toFixed(2)),
      pdi: Number(latest.pdi.toFixed(2)),
      mdi: Number(latest.mdi.toFixed(2)),
    };
  }

  public static calculateVWAP(candles: Candle[]): number | null {
    if (!candles || candles.length === 0) return null;

    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (const c of candles) {
      const vol = c.volume && c.volume > 0 ? c.volume : 1;
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativeTPV += typicalPrice * vol;
      cumulativeVolume += vol;
    }

    if (cumulativeVolume === 0) return null;
    return Number((cumulativeTPV / cumulativeVolume).toFixed(2));
  }

  public static calculateBollingerBands(
    candles: Candle[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: number; middle: number; lower: number; bandwidthPct: number } | null {
    if (!candles || candles.length < period) return null;

    const closes = candles.map((c) => c.close);
    const results = BollingerBands.calculate({ period, stdDev, values: closes });
    if (!results || results.length === 0) return null;

    const latest = results[results.length - 1];
    const bandwidth = ((latest.upper - latest.lower) / latest.middle) * 100;

    return {
      upper: Number(latest.upper.toFixed(2)),
      middle: Number(latest.middle.toFixed(2)),
      lower: Number(latest.lower.toFixed(2)),
      bandwidthPct: Number(bandwidth.toFixed(2)),
    };
  }

  public static calculateATR(candles: Candle[], period: number = 14): number | null {
    if (!candles || candles.length < period + 1) return null;

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trueRanges.push(tr);
    }

    const recent = trueRanges.slice(-period);
    return Number((recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(2));
  }

  public static findRecentSwingRange(candles: Candle[], lookback: number = 50): { swingHigh: number | null; swingLow: number | null } {
    if (!candles || candles.length === 0) return { swingHigh: null, swingLow: null };

    const window = candles.slice(-lookback);
    return {
      swingHigh: Number(Math.max(...window.map((c) => c.high)).toFixed(2)),
      swingLow: Number(Math.min(...window.map((c) => c.low)).toFixed(2)),
    };
  }

  public static getComprehensiveTelemetry(candles: Candle[]): IndicatorTelemetry {
    const closes = candles.map((c) => c.close);

    return {
      rsi: this.calculateRSI(closes),
      sma: this.calculateSMA(closes, 20),
      atr: this.calculateATR(candles),
      adx: this.calculateADX(candles),
      vwap: this.calculateVWAP(candles),
      bollingerBands: this.calculateBollingerBands(candles),
      swingRange: this.findRecentSwingRange(candles),
    };
  }
}

// ============================================
// CRYPTO WEBSOCKET SERVICE
// ============================================

export class CryptoWsService {
  private static ws: WebSocket | null = null;
  private static activeStreams: Set<string> = new Set();
  private static subscribers: Map<string, (candle: WebSocketCandle) => void> = new Map();

  public static subscribeToKline(symbol: string, interval: string, callback: (candle: WebSocketCandle) => void): void {
    if (MarketService.isIndexSymbol(symbol)) return;

    const cleanSymbol = symbol.replace("/", "").toLowerCase();
    const streamName = `${cleanSymbol}@kline_${interval}`;
    this.subscribers.set(streamName, callback);

    if (this.activeStreams.has(streamName)) return;
    this.activeStreams.add(streamName);

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connectMasterSocket();
    }
  }

  private static connectMasterSocket(): void {
    if (this.activeStreams.size === 0) return;

    const streamName = Array.from(this.activeStreams)[0];
    this.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamName}`);

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.data && parsed.data.k) {
          const k = parsed.data.k;
          const formattedCandle: WebSocketCandle = {
            timestamp: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            isFinal: k.x,
          };

          for (const [stream, callback] of this.subscribers) {
            if (stream.includes(parsed.data.s?.toLowerCase() || "")) {
              callback(formattedCandle);
              break;
            }
          }
        }
      } catch (err) {
        console.error("[Crypto WS Error]:", err);
      }
    });
  }
}

// ============================================
// MARKET ORCHESTRATOR
// ============================================

export class MarketOrchestrator {
  public static async getDynamicMarketData(symbol: string, interval: string = "1h"): Promise<MarketDataPayload> {
    const formattedSymbol = symbol.replace("/", "").trim().toUpperCase();
    const cleanRedisKey = `orion:live:${formattedSymbol}:${interval}`;

    try {
      const cachedData = await redisClient.get(cleanRedisKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        if (parsed && Array.isArray(parsed.candles) && parsed.candles.length > 0) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn("[MarketOrchestrator] Cache read skipped:", err);
    }

    const [candles, headlines] = await Promise.all([
      MarketService.getCandles(formattedSymbol, interval, 50),
      NewsService.fetchNews(formattedSymbol).catch(() => []),
    ]);

    if (!candles || candles.length === 0) {
      throw new Error(`No data available for ${formattedSymbol}`);
    }

    const latestCandle = candles[candles.length - 1];
    const assetType = MarketService.isIndexSymbol(formattedSymbol)
      ? "index"
      : MarketService.isCryptoSymbol(formattedSymbol)
      ? "crypto"
      : "forex";

    const marketPayload: MarketDataPayload = {
      symbol: formattedSymbol,
      interval,
      assetType,
      latestPrice: latestCandle.close,
      candles,
      headlines: headlines || [],
      lastUpdated: new Date().toISOString(),
    };

    try {
      await redisClient.set(cleanRedisKey, JSON.stringify(marketPayload), "EX", 30);
    } catch (err) {
      console.warn("[MarketOrchestrator] Cache write skipped:", err);
    }

    return marketPayload;
  }
}

// ============================================
// FOREX / TWELVE DATA PROVIDER
// ============================================

export class TwelveDataForexProvider implements IForexProvider {
  private apiKey: string;
  private baseUrl: string = "https://api.twelvedata.com";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  getProviderName(): string {
    return "TwelveData";
  }

  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    let formattedSymbol = symbol;
    if (formattedSymbol.length === 6 && !formattedSymbol.includes("/")) {
      formattedSymbol = `${formattedSymbol.slice(0, 3)}/${formattedSymbol.slice(3)}`;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/time_series`, {
        params: {
          symbol: formattedSymbol,
          interval,
          outputsize: limit,
          apikey: this.apiKey,
        },
        timeout: 5000,
      });

      if (!response.data || !Array.isArray(response.data.values)) {
        throw new Error("Invalid response from TwelveData");
      }

      return response.data.values.reverse().map((v: any) => ({
        datetime: new Date(v.datetime).toISOString(),
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: parseFloat(v.volume || 0),
      }));
    } catch (error: any) {
      throw new Error(`TwelveData failed for ${symbol}: ${error.message}`);
    }
  }
}

// ============================================
// MARKET WATCHLIST
// ============================================

export class MarketWatchList {
  public static async getSupportedSymbols(category?: string): Promise<any> {
    try {
      let query = 'SELECT symbol, name, category, exchange FROM supported_symbols';
      const params: string[] = [];

      if (category) {
        query += ' WHERE LOWER(category) = $1';
        params.push(category.toLowerCase());
      }

      const { rows } = await pgPool.query(query, params);

      if (!category) {
        return {
          crypto: rows.filter((r: any) => r.category === 'crypto'),
          forex: rows.filter((r: any) => r.category === 'forex'),
        };
      }

      return { symbols: rows };
    } catch (error) {
      console.error("[Database Error - getSupportedSymbols]:", error);
      return category ? { symbols: [] } : { crypto: [], forex: [] };
    }
  }

  public static async getUserWatchlist(userId: string | any): Promise<any[]> {
    try {
      const query = `
        SELECT s.symbol, s.name, s.category, s.exchange 
        FROM user_watchlist w
        JOIN supported_symbols s ON w.symbol = s.symbol
        WHERE w.user_id = $1
      `;
      const { rows } = await pgPool.query(query, [userId]);
      return rows;
    } catch (error) {
      console.error("[Database Error - getUserWatchlist]:", error);
      return [];
    }
  }

  public static async addToWatchlist(userId: string | number, symbol: string): Promise<any> {
    try {
      const query = `
        INSERT INTO user_watchlist (user_id, symbol)
        VALUES ($1, $2)
        ON CONFLICT (user_id, symbol) DO NOTHING
        RETURNING *;
      `;
      const { rows } = await pgPool.query(query, [userId, symbol]);
      return rows[0] || null;
    } catch (error) {
      console.error("[Database Error - addToWatchlist]:", error);
      return null;
    }
  }

  public static async removeFromWatchlist(userId: string | number, symbol: string): Promise<boolean> {
    try {
      const query = `
        DELETE FROM user_watchlist 
        WHERE user_id = $1 AND symbol = $2
        RETURNING *;
      `;
      const { rows } = await pgPool.query(query, [userId, symbol]);
      return rows.length > 0;
    } catch (error) {
      console.error("[Database Error - removeFromWatchlist]:", error);
      return false;
    }
  }
}