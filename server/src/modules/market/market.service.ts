// market.service.ts
import { RSI, SMA } from "technicalindicators";
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
  assetType: string;
  latestPrice: number;
  candles: Candle[];
  headlines?: any[];
  lastUpdated: string;
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

// Forex Provider Interface - Plug in later
export interface IForexProvider {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  getProviderName(): string;
}

// ============================================
// MARKET SERVICE - CRYPTO WITH MULTIPLE FALLBACKS
// ============================================

export class MarketService {
  private static cache: Map<string, { candles: Candle[]; timestamp: number }> = new Map();
  private static CACHE_TTL = 60000; // 1 minute
  private static forexProvider: IForexProvider | null = null;
  private static isBinanceAvailable = true;
  private static lastBinanceCheck = 0;
  private static BINANCE_CHECK_INTERVAL = 30000; // Check every 30 seconds

  /**
   * Register a forex provider (can be plugged in later)
   */
  public static registerForexProvider(provider: IForexProvider): void {
    this.forexProvider = provider;
    console.log(`[MarketService] Forex provider registered: ${provider.getProviderName()}`);
  }

  /**
   * Main method to get candles - auto-detects crypto vs forex
   */
  public static async getCandles(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 50
  ): Promise<Candle[]> {
    const formattedSymbol = symbol.trim().toUpperCase();
    const cacheKey = `${formattedSymbol}:${interval}:${limit}`;
    
    // Check memory cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log(`[Cache] Returning cached data for ${formattedSymbol}`);
      return cached.candles;
    }

    let candles: Candle[] = [];

    try {
      // Check if it's crypto or forex
      const isCrypto = this.isCryptoSymbol(formattedSymbol);

      if (isCrypto) {
        candles = await this.fetchCryptoData(formattedSymbol, interval, limit);
      } else {
        // Use forex provider if registered
        if (this.forexProvider) {
          candles = await this.forexProvider.getCandles(formattedSymbol, interval, limit);
        } else {
          console.warn(`[MarketService] No forex provider for ${formattedSymbol}`);
          candles = [];
        }
      }
    } catch (error: any) {
      console.error(`[MarketService] Error fetching ${formattedSymbol}:`, error.message);
      candles = [];
    }

    // If we got no candles, return empty array (NO MOCK DATA)
    if (!candles || candles.length === 0) {
      console.warn(`[MarketService] No data available for ${formattedSymbol}`);
      return [];
    }

    // Cache the result
    this.cache.set(cacheKey, { candles, timestamp: Date.now() });
    
    return candles;
  }

  /**
   * Fetch crypto data with multiple fallbacks
   */
  private static async fetchCryptoData(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const providers = [
      { name: 'Binance', fn: () => this.fetchBinanceCrypto(symbol, interval, limit) },
      { name: 'CoinCap', fn: () => this.fetchCoinCapCrypto(symbol, interval, limit) },
      { name: 'Kraken', fn: () => this.fetchKrakenCrypto(symbol, interval, limit) },
      { name: 'Bitfinex', fn: () => this.fetchBitfinexCrypto(symbol, interval, limit) },
    ];

    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        console.log(`[MarketService] Trying ${provider.name} for ${symbol}...`);
        const candles = await provider.fn();
        if (candles && candles.length > 0) {
          console.log(`[MarketService] Successfully fetched ${candles.length} candles from ${provider.name}`);
          return candles;
        }
      } catch (error: any) {
        lastError = error;
        console.warn(`[${provider.name}] Failed: ${error.message}`);
        // Continue to next provider
        continue;
      }
    }

    // If all providers fail, throw error
    throw new Error(`All providers failed for ${symbol}: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Check if symbol is crypto
   */
  private static isCryptoSymbol(symbol: string): boolean {
    const cryptoQuotes = ["USDT", "BTC", "ETH", "BNB", "BUSD", "USDC", "DAI", "TUSD"];
    return cryptoQuotes.some((q) => symbol.endsWith(q)) ||
      symbol.includes("USDT") ||
      symbol.includes("BTC") ||
      (symbol.length >= 6 && !symbol.includes("/"));
  }

  /**
   * Check if Binance is available
   */
  private static async checkBinanceAvailability(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastBinanceCheck < this.BINANCE_CHECK_INTERVAL) {
      return this.isBinanceAvailable;
    }

    try {
      const response = await axios.get('https://api.binance.com/api/v3/ping', {
        timeout: 3000
      });
      this.isBinanceAvailable = response.status === 200;
    } catch (error) {
      this.isBinanceAvailable = false;
    }
    this.lastBinanceCheck = now;
    return this.isBinanceAvailable;
  }

  /**
   * PROVIDER 1: Binance REST API
   */
  private static async fetchBinanceCrypto(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const isAvailable = await this.checkBinanceAvailability();
    if (!isAvailable) {
      throw new Error('Binance API is currently unavailable');
    }

    const intervalMap: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
      '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h',
      '8h': '8h', '12h': '12h', '1d': '1d', '3d': '3d',
      '1w': '1w', '1M': '1M'
    };
    
    const binanceInterval = intervalMap[interval] || '1h';
    let binanceSymbol = symbol.replace('/', '').toUpperCase();
    
    const hasQuote = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH'].some(q => binanceSymbol.endsWith(q));
    if (!hasQuote) {
      binanceSymbol = `${binanceSymbol}USDT`;
    }

    const symbolsToTry = [
      binanceSymbol,
      binanceSymbol.replace('USDT', ''),
      binanceSymbol.replace('BUSD', 'USDT'),
      binanceSymbol.replace('USDC', 'USDT'),
    ];

    const uniqueSymbols = [...new Set(symbolsToTry)]
      .filter(s => s.length > 0)
      .map(s => s.endsWith('USDT') ? s : `${s}USDT`);

    let lastError: Error | null = null;

    for (const trySymbol of uniqueSymbols) {
      try {
        console.log(`[Binance] Fetching ${trySymbol} ${binanceInterval}...`);
        
        const response = await axios.get('https://api.binance.com/api/v3/klines', {
          params: {
            symbol: trySymbol,
            interval: binanceInterval,
            limit: Math.min(limit, 500)
          },
          timeout: 5000,
          headers: {
            'Accept-Encoding': 'gzip'
          }
        });

        if (!Array.isArray(response.data) || response.data.length === 0) {
          throw new Error('No data from Binance');
        }

        const candles = response.data.map((kline: any[]) => ({
          datetime: new Date(kline[0]).toISOString(),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5])
        }));

        console.log(`[Binance] Successfully fetched ${candles.length} candles for ${trySymbol}`);
        return candles;

      } catch (error: any) {
        lastError = error;
        console.warn(`[Binance] Failed for ${trySymbol}:`, error.message);
        continue;
      }
    }

    throw new Error(`All Binance attempts failed: ${lastError?.message}`);
  }

  /**
   * PROVIDER 2: CoinCap API (No API Key Required)
   */
  private static async fetchCoinCapCrypto(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const intervalMap: Record<string, string> = {
      '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30',
      '1h': 'h1', '2h': 'h2', '4h': 'h4', '6h': 'h6',
      '12h': 'h12', '1d': 'd1', '1w': 'w1', '1M': 'M1'
    };
    
    const coinCapInterval = intervalMap[interval] || 'h1';
    
    const coinMap: Record<string, string> = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'BNB': 'binance-coin',
      'SOL': 'solana',
      'ADA': 'cardano',
      'XRP': 'ripple',
      'DOGE': 'dogecoin',
      'DOT': 'polkadot',
      'AVAX': 'avalanche-2',
      'MATIC': 'matic-network',
      'LINK': 'chainlink',
      'UNI': 'uniswap',
      'ATOM': 'cosmos',
      'LTC': 'litecoin',
      'BCH': 'bitcoin-cash',
      'NEAR': 'near',
      'ALGO': 'algorand',
      'VET': 'vechain',
      'ICP': 'internet-computer',
      'FIL': 'filecoin',
      'HBAR': 'hedera-hashgraph',
      'ETC': 'ethereum-classic',
      'XLM': 'stellar',
      'STX': 'blockstack',
      'RNDR': 'render-token',
      'MKR': 'maker',
      'AAVE': 'aave',
      'CRV': 'curve-dao-token',
      'APE': 'apecoin',
      'QNT': 'quant-network'
    };

    let baseSymbol = symbol;
    for (const quote of ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH']) {
      if (baseSymbol.endsWith(quote)) {
        baseSymbol = baseSymbol.replace(quote, '');
        break;
      }
    }

    const coinId = coinMap[baseSymbol] || baseSymbol.toLowerCase();
    
    try {
      console.log(`[CoinCap] Fetching ${coinId} with interval ${coinCapInterval}...`);
      
      const response = await axios.get(`https://api.coincap.io/v2/assets/${coinId}/history`, {
        params: {
          interval: coinCapInterval,
          limit: Math.min(limit, 2000)
        },
        timeout: 5000,
        headers: {
          'Accept-Encoding': 'gzip'
        }
      });

      if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
        throw new Error('Invalid response from CoinCap');
      }

      const data = response.data.data;
      
      let prevPrice = parseFloat(data[0]?.priceUsd || 0);
      
      const candles = data.map((item: any, index: number) => {
        const currentPrice = parseFloat(item.priceUsd);
        const open = index === 0 ? currentPrice : prevPrice;
        const close = currentPrice;
        const spread = Math.abs(close - open) + (currentPrice * 0.001);
        const high = Math.max(open, close) + (spread * 0.4);
        const low = Math.min(open, close) - (spread * 0.4);
        
        prevPrice = close;
        
        return {
          datetime: new Date(item.time).toISOString(),
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          volume: 0,
        };
      });

      console.log(`[CoinCap] Successfully fetched ${candles.length} candles for ${symbol}`);
      return candles;

    } catch (error: any) {
      throw new Error(`CoinCap failed: ${error.message}`);
    }
  }

  /**
   * PROVIDER 3: Kraken API (No API Key Required)
   */
  private static async fetchKrakenCrypto(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const intervalMap: Record<string, string> = {
      '1m': '1', '5m': '5', '15m': '15', '30m': '30',
      '1h': '60', '2h': '120', '4h': '240', '6h': '360',
      '12h': '720', '1d': '1440', '1w': '10080', '1M': '43200'
    };
    
    const krakenInterval = intervalMap[interval] || '60';
    
    // Kraken uses XBT for BTC
    let krakenSymbol = symbol.replace('/', '').toUpperCase();
    if (krakenSymbol.startsWith('BTC')) {
      krakenSymbol = `XBT${krakenSymbol.replace('BTC', '')}`;
    }
    
    // Kraken expects USD instead of USDT
    krakenSymbol = krakenSymbol.replace('USDT', 'USD');
    krakenSymbol = krakenSymbol.replace('BUSD', 'USD');
    krakenSymbol = krakenSymbol.replace('USDC', 'USD');
    
    try {
      console.log(`[Kraken] Fetching ${krakenSymbol} with interval ${krakenInterval}...`);
      
      const response = await axios.get('https://api.kraken.com/0/public/OHLC', {
        params: {
          pair: krakenSymbol,
          interval: krakenInterval,
          since: Math.floor(Date.now() / 1000) - (limit * 60 * parseInt(krakenInterval))
        },
        timeout: 5000,
        headers: {
          'Accept-Encoding': 'gzip'
        }
      });

      if (!response.data || !response.data.result || !response.data.result[krakenSymbol]) {
        throw new Error('Invalid response from Kraken');
      }

      const ohlcData = response.data.result[krakenSymbol];
      
      if (!Array.isArray(ohlcData) || ohlcData.length === 0) {
        throw new Error('No data from Kraken');
      }

      // Kraken returns: [time, open, high, low, close, vwap, volume, count]
      const candles = ohlcData.slice(-limit).map((item: any[]) => ({
        datetime: new Date(item[0] * 1000).toISOString(),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[6])
      }));

      console.log(`[Kraken] Successfully fetched ${candles.length} candles for ${symbol}`);
      return candles;

    } catch (error: any) {
      throw new Error(`Kraken failed: ${error.message}`);
    }
  }

  /**
   * PROVIDER 4: Bitfinex API (No API Key Required)
   */
  private static async fetchBitfinexCrypto(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const intervalMap: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
      '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h',
      '12h': '12h', '1d': '1D', '1w': '7D', '1M': '30D'
    };
    
    const bitfinexInterval = intervalMap[interval] || '1h';
    let bitfinexSymbol = symbol.replace('/', '').toUpperCase();
    
    // Bitfinex uses tBTCUSD format
    bitfinexSymbol = `t${bitfinexSymbol}`;
    
    try {
      console.log(`[Bitfinex] Fetching ${bitfinexSymbol} with interval ${bitfinexInterval}...`);
      
      const response = await axios.get(`https://api-pub.bitfinex.com/v2/candles/trade:${bitfinexInterval}:${bitfinexSymbol}/hist`, {
        params: {
          limit: Math.min(limit, 10000),
          sort: 1 // Ascending
        },
        timeout: 5000,
        headers: {
          'Accept-Encoding': 'gzip'
        }
      });

      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error('Invalid response from Bitfinex');
      }

      // Bitfinex returns: [timestamp, open, close, high, low, volume]
      const candles = response.data.map((item: any[]) => ({
        datetime: new Date(item[0]).toISOString(),
        open: parseFloat(item[1]),
        high: parseFloat(item[3]),
        low: parseFloat(item[4]),
        close: parseFloat(item[2]),
        volume: parseFloat(item[5])
      }));

      console.log(`[Bitfinex] Successfully fetched ${candles.length} candles for ${symbol}`);
      return candles;

    } catch (error: any) {
      throw new Error(`Bitfinex failed: ${error.message}`);
    }
  }

  /**
   * Get historical klines in a simplified format
   */
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
   * Clear cache
   */
  public static clearCache(): void {
    this.cache.clear();
    console.log('[Cache] Cleared');
  }
}

// ============================================
// MARKET MATH SERVICE
// ============================================

export class MarketMathService {
  public static calculateRSI(
    closingPrice: number[],
    period: number = 14
  ): number[] {
    if (!closingPrice || closingPrice.length < period) {
      return [];
    }
    return RSI.calculate({ values: closingPrice, period });
  }

  public static calculateSMA(
    closingPrice: number[],
    period: number = 14
  ): number[] {
    if (!closingPrice || closingPrice.length < period) {
      return [];
    }
    return SMA.calculate({ values: closingPrice, period });
  }
}

// ============================================
// CRYPTO WEBSOCKET SERVICE (Binance)
// ============================================

export class CryptoWsService {
  private static ws: WebSocket | null = null;
  private static activeStreams: Set<string> = new Set();
  private static subscribers: Map<string, (candle: WebSocketCandle) => void> = new Map();
  private static reconnectTimeout: NodeJS.Timeout | null = null;
  private static isConnecting: boolean = false;
  private static reconnectAttempts: number = 0;
  private static MAX_RECONNECT_ATTEMPTS = 5;

  public static subscribeToKline(
    symbol: string,
    interval: string,
    callback: (candle: WebSocketCandle) => void
  ): void {
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    this.subscribers.set(streamName, callback);

    if (this.activeStreams.has(streamName)) {
      return;
    }

    this.activeStreams.add(streamName);

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connectMasterSocket();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(streamName);
    }
  }

  private static sendSubscribe(streamName: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    try {
      const subPayload = JSON.stringify({
        method: "SUBSCRIBE",
        params: [streamName],
        id: Date.now(),
      });
      this.ws.send(subPayload);
      console.log(`[Crypto WS]: Subscribed to ${streamName}`);
    } catch (err: any) {
      console.error("[Crypto WS Subscribe Error]:", err.message);
    }
  }

  private static connectMasterSocket(): void {
    if (this.isConnecting) return;
    if (this.activeStreams.size === 0) return;

    this.isConnecting = true;

    try {
      const streamName = Array.from(this.activeStreams)[0];
      const url = `wss://stream.binance.com:9443/ws/${streamName}`;

      console.log(`[Crypto WS]: Connecting to ${url}`);
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        console.log(`[Crypto WS]: Connected successfully`);
        this.isConnecting = false;
        this.reconnectAttempts = 0;
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.data && parsed.data.k) {
            const kline = parsed.data.k;
            const formattedCandle: WebSocketCandle = {
              timestamp: kline.t,
              open: parseFloat(kline.o),
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
              volume: parseFloat(kline.v),
              isFinal: kline.x,
            };

            for (const [stream, callback] of this.subscribers) {
              if (stream.includes(parsed.data.s?.toLowerCase() || '')) {
                callback(formattedCandle);
                break;
              }
            }
          }
        } catch (err) {
          console.error("[Crypto WS Message Error]:", err);
        }
      });

      this.ws.on("close", (code, reason) => {
        console.warn(`[Crypto WS]: Connection closed (${code}). Reconnecting...`);
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
      });

      this.ws.on("error", (err: any) => {
        console.error("[Crypto WS Error]:", err.message);
        this.isConnecting = false;
        if (this.ws) {
          this.ws.terminate();
          this.ws = null;
        }
        this.scheduleReconnect();
      });

      setTimeout(() => {
        if (this.isConnecting) {
          console.warn("[Crypto WS]: Connection timeout");
          this.ws?.close();
          this.ws = null;
          this.isConnecting = false;
          this.scheduleReconnect();
        }
      }, 10000);

    } catch (err: any) {
      console.error("[Crypto WS Connection Exception]:", err.message);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private static scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.warn("[Crypto WS]: Max reconnect attempts reached. Stopping.");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[Crypto WS]: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimeout = setTimeout(() => {
      if (this.activeStreams.size > 0) {
        this.connectMasterSocket();
      }
    }, delay);
  }

  public static unsubscribe(symbol: string, interval: string): void {
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    this.activeStreams.delete(streamName);
    this.subscribers.delete(streamName);
    
    if (this.activeStreams.size === 0 && this.ws) {
      this.ws.close();
      this.ws = null;
      this.reconnectAttempts = 0;
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
    }
  }
}

// ============================================
// MARKET ORCHESTRATOR
// ============================================

export class MarketOrchestrator {
  private static activeCryptoStreams: Set<string> = new Set();

  public static async getDynamicMarketData(
    symbol: string,
    interval: string = "1h"
  ): Promise<MarketDataPayload> {
    const formattedSymbol = symbol.trim().toUpperCase();
    const cleanRedisKey = `orion:live:${formattedSymbol}:${interval}`;

    // Try cache
    try {
      const cachedData = await redisClient.get(cleanRedisKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        if (parsed && Array.isArray(parsed.candles) && parsed.candles.length > 0) {
          this.ensureBackgroundTracking(formattedSymbol, interval);
          return parsed;
        }
      }
    } catch (err) {
      console.warn("[MarketOrchestrator] Cache read failed:", err);
    }

    // Fetch fresh data
    let candles: Candle[] = [];
    let headlines: any[] = [];

    try {
      [candles, headlines] = await Promise.all([
        MarketService.getCandles(formattedSymbol, interval, 50),
        NewsService.fetchNews(formattedSymbol).catch(() => [] as any[]),
      ]);
    } catch (error) {
      console.error("[MarketOrchestrator] Error fetching data:", error);
    }

    // If no candles, throw error (NO MOCK DATA)
    if (!candles || candles.length === 0) {
      throw new Error(`No data available for ${formattedSymbol}`);
    }

    const latestCandle = candles[candles.length - 1];

    const marketPayload: MarketDataPayload = {
      symbol: formattedSymbol,
      interval,
      assetType: "crypto",
      latestPrice: latestCandle.close,
      candles: candles,
      headlines: headlines || [],
      lastUpdated: new Date().toISOString(),
    };

    // Cache asynchronously
    try {
      await redisClient.set(cleanRedisKey, JSON.stringify(marketPayload));
    } catch (err) {
      console.warn("[MarketOrchestrator] Cache write failed:", err);
    }

    this.ensureBackgroundTracking(formattedSymbol, interval);
    return marketPayload;
  }

  private static ensureBackgroundTracking(symbol: string, interval: string): void {
    const streamId = `${symbol}:${interval}`;
    if (!this.activeCryptoStreams.has(streamId)) {
      console.log(`[Market Orchestrator]: Starting WebSocket for ${symbol}`);

      CryptoWsService.subscribeToKline(
        symbol,
        interval,
        async (liveCandle: WebSocketCandle) => {
          try {
            const chartCandle = {
              time: Math.floor(liveCandle.timestamp / 1000),
              open: liveCandle.open,
              high: liveCandle.high,
              low: liveCandle.low,
              close: liveCandle.close,
            };

            await redisClient.publish(
              "ORION_KLINES",
              JSON.stringify({ symbol, interval, candle: chartCandle })
            );

            const redisKey = `orion:live:${symbol}:${interval}`;
            const cachedPayloadStr = await redisClient.get(redisKey);

            if (cachedPayloadStr) {
              const payload = JSON.parse(cachedPayloadStr);
              if (payload && Array.isArray(payload.candles) && payload.candles.length > 0) {
                payload.latestPrice = liveCandle.close ?? payload.latestPrice;
                payload.lastUpdated = new Date().toISOString();

                const lastCandle = payload.candles[payload.candles.length - 1];
                if (lastCandle) {
                  lastCandle.open = liveCandle.open;
                  lastCandle.high = liveCandle.high;
                  lastCandle.low = liveCandle.low;
                  lastCandle.close = liveCandle.close;
                }

                await redisClient.set(redisKey, JSON.stringify(payload));
              }
            }
          } catch (err) {
            console.error("[WebSocket Update Error]:", err);
          }
        }
      );

      this.activeCryptoStreams.add(streamId);
    }
  }
}

// ============================================
// FOREX PROVIDERS (Ready to plug in later)
// ============================================

/**
 * Twelve Data Forex Provider - Ready to use
 */
export class TwelveDataForexProvider implements IForexProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = "https://api.twelvedata.com";
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
          apikey: this.apiKey
        },
        timeout: 5000
      });

      if (response.data.status === "error") {
        throw new Error(response.data.message);
      }

      if (!response.data.values || !Array.isArray(response.data.values)) {
        throw new Error("Invalid response from Twelve Data");
      }

      return response.data.values.map((item: any) => ({
        datetime: item.datetime,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseFloat(item.volume || 0)
      })).reverse();

    } catch (error: any) {
      throw new Error(`[TwelveData] Failed for ${symbol}: ${error.message}`);
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

  public static async getUserWatchlist(userId: string | number): Promise<any[]> {
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