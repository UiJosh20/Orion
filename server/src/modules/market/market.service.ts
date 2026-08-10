import { RSI, SMA } from "technicalindicators";
import { ENV } from "../../config/env.js";
import axios from "axios";
import WebSocket from "ws";
import { redisClient } from "../../config/redis.js";

const TWELVE_DATA_URL = "https://api.twelvedata.com";
const BINANCE_URL = "https://api.binance.com/api/v3";
const TWELVE_DATA_API_KEY = ENV.TWELVE_DATA_API_KEY;

export class MarketService {
  /**
   * Route candle fetching dynamically based on asset type
   * @param symbol E.g., 'BTCUSDT' for crypto or 'EUR/USD' for forex
   * @param interval Timeframe ('1h', '1d', etc.)
   * @param limit Number of data points
   */
  public static async getCandles(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 50,
  ) {
    let formattedSymbol = symbol.trim().toUpperCase();

    // Determine if it's crypto vs forex based on common crypto quote suffixes
    const cryptoQuotes = ["USDT", "BTC", "ETH", "BNB", "BUSD", "USDC"];
    const isCrypto =
      cryptoQuotes.some((q) => formattedSymbol.endsWith(q)) ||
      formattedSymbol.includes("USDT");

    if (!isCrypto) {
      // Automatically insert a slash for standard 6-letter forex pairs if missing (e.g., GBPUSD -> GBP/USD)
      if (formattedSymbol.length === 6 && !formattedSymbol.includes("/")) {
        formattedSymbol = `${formattedSymbol.slice(0, 3)}/${formattedSymbol.slice(3)}`;
      }
      return await this.fetchTwelveDataForex(formattedSymbol, interval, limit);
    } else {
      // Normalize crypto symbols for Binance (e.g., BTC/USDT -> BTCUSDT)
      const binanceSymbol = formattedSymbol.replace("/", "");
      return await this.fetchBinanceCrypto(binanceSymbol, interval, limit);
    }
  }

  private static async fetchBinanceCrypto(
    symbol: string,
    interval: string,
    limit: number,
  ) {
    try {
      // Normalize crypto symbols for Binance (e.g., BTC/USDT -> BTCUSDT)
      const formattedSymbol = symbol.replace("/", "").toUpperCase();

      const response = await axios.get(`${BINANCE_URL}/klines`, {
        params: {
          symbol: formattedSymbol,
          interval,
          limit,
        },
      });

      // Map Binance array format [openTime, open, high, low, close, volume, ...]
      return response.data.map((item: any[]) => ({
        datetime: new Date(item[0]).toISOString(),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      }));
    } catch (error) {
      console.error("[Binance API Error]:", error);
      throw error;
    }
  }

  private static async fetchTwelveDataForex(
    symbol: string,
    interval: string,
    limit: number,
  ) {
    try {
      const response = await axios.get(`${TWELVE_DATA_URL}/time_series`, {
        params: {
          symbol,
          interval,
          outputsize: limit,
          apikey: TWELVE_DATA_API_KEY,
        },
      });

      if (response.data.status === "error") {
        throw new Error(
          response.data.message || `Failed to fetch forex data for ${symbol}`,
        );
      }

      return response.data.values
        .map((item: any) => ({
          datetime: item.datetime,
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          close: parseFloat(item.close),
          volume: item.volume ? parseFloat(item.volume) : 0,
        }))
        .reverse();
    } catch (error) {
      console.error("[Twelve Data API Error]:", error);
      throw error;
    }
  }
}

export class MarketMathService {
  public static calculateRSI(
    closingPrice: number[],
    period: number = 14,
  ): number[] {
    /**
     * Calculate Relative Strength Index (RSI) for trend momentum
     * @param closingPrices Array of historical close prices (e.g., [1.0850, 1.0862, ...])
     * @param period Lookback period, typically 14
     */
    const input = {
      values: closingPrice,
      period,
    };
    return RSI.calculate(input);
  }

  public static calculateSMA(
    closingPrice: number[],
    period: number = 14,
  ): number[] {
    /**
     * Calculate Simple Moving Average (SMA) for trend smoothing
     * @param closingPrices Array of historical close prices (e.g., [1.0850, 1.0862, ...])
     * @param period Lookback period, typically 14
     */
    const input = {
      values: closingPrice,
      period,
    };
    return SMA.calculate(input);
  }
}

export class CryptoWsService {
  private static ws: WebSocket | null = null;
  private static activeStreams: Set<string> = new Set();
  private static subscribers: Map<string, (candle: any) => void> = new Map();
  private static reconnectTimeout: NodeJS.Timeout | null = null;

  public static subscribeToKline(symbol: string, interval: string, callback: (candle: any) => void) {
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    this.subscribers.set(streamName, callback);

    if (this.activeStreams.has(streamName)) {
      return; // Already streaming this pair/interval
    }

    this.activeStreams.add(streamName);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connectMasterSocket();
    } else {
      // Send dynamic subscription frame to existing master socket
      const subPayload = JSON.stringify({
        method: 'SUBSCRIBE',
        params: [streamName],
        id: Date.now(),
      });
      this.ws.send(subPayload);
      console.log(`[Crypto WS]: Dynamically added stream -> ${streamName}`);
    }
  }

  private static connectMasterSocket() {
    if (this.activeStreams.size === 0) return;

    const streamsParam = Array.from(this.activeStreams).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streamsParam}`;

    console.log(`[Crypto WS]: Connecting to master multi-stream socket...`);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log(`[Crypto WS]: Master connection established successfully.`);
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        // Combined stream structure: { stream: 'btcusdt@kline_1h', data: { ... } }
        if (parsed.stream && parsed.data && parsed.data.k) {
          const kline = parsed.data.k;
          const formattedCandle = {
            timestamp: kline.t,
            open: parseFloat(kline.o),
            high: parseFloat(kline.h),
            low: parseFloat(kline.l),
            close: parseFloat(kline.c),
            volume: parseFloat(kline.v),
            isFinal: kline.x,
          };

          const callback = this.subscribers.get(parsed.stream);
          if (callback) {
            callback(formattedCandle);
          }
        }
      } catch (err) {
        console.error('[Crypto WS Message Error]:', err);
      }
    });

    this.ws.on('close', () => {
      console.warn('[Crypto WS]: Master connection closed. Reconnecting in 5s...');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[Crypto WS Error]:', err);
      this.ws?.terminate();
    });
  }

  private static scheduleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connectMasterSocket();
    }, 5000);
  }
}

export class ForexPollerService {
  private static pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start polling a forex pair periodically in the background
   * @param symbol E.g., 'EUR/USD'
   * @param interval Timeframe ('1h', '1d', etc.)
   * @param frequencyMs How often to poll (default to 60,000ms / 1 min to stay safe on free limits)
   */
  public static startPolling(
    symbol: string = "EUR/USD",
    interval: string = "1h",
    frequencyMs: number = 60000,
  ) {
    const formattedSymbol = symbol.toUpperCase();
    const pollerKey = `${formattedSymbol}:${interval}`;

    // Clear existing interval if already running
    if (this.pollingIntervals.has(pollerKey)) {
      clearInterval(this.pollingIntervals.get(pollerKey)!);
    }

    console.log(
      `[Forex Poller]: Initialized background polling for ${formattedSymbol} every ${frequencyMs / 1000}s`,
    );

    // Perform an initial fetch immediately on startup
    this.fetchAndCacheForex(formattedSymbol, interval);

    // Set up recurring background poll
    const intervalId = setInterval(async () => {
      await this.fetchAndCacheForex(formattedSymbol, interval);
    }, frequencyMs);

    this.pollingIntervals.set(pollerKey, intervalId);
  }

  private static async fetchAndCacheForex(symbol: string, interval: string) {
    try {
      // Calls your existing Twelve Data REST service method
      const candles = await MarketService.getCandles(symbol, interval, 50);

      const latestCandle = candles[candles.length - 1];
      const marketDataPayload = {
        symbol,
        interval,
        assetType: "forex",
        latestPrice: latestCandle.close,
        candles,
        lastUpdated: new Date().toISOString(),
      };

      // Store in Redis just like the crypto WebSocket data
      const redisKey = `orion:live:${symbol.replace("/", "")}:${interval}`;
      await redisClient.set(redisKey, JSON.stringify(marketDataPayload));

      console.log(
        `[Forex Poller]: Successfully polled & cached ${symbol} -> Latest Close: ${latestCandle.close}`,
      );
    } catch (error: any) {
      console.error(`[Forex Poller Error - ${symbol}]:`, error.message);
    }
  }

  public static stopPolling(symbol: string, interval: string) {
    const pollerKey = `${symbol.toUpperCase()}:${interval}`;
    if (this.pollingIntervals.has(pollerKey)) {
      clearInterval(this.pollingIntervals.get(pollerKey)!);
      this.pollingIntervals.delete(pollerKey);
      console.log(`[Forex Poller]: Stopped background polling for ${symbol}`);
    }
  }
}

export class MarketOrchestrator {
  private static activeCryptoStreams: Set<string> = new Set();
  private static activeForexPollers: Set<string> = new Set();

  /**
   * Dynamically get market data, serving from Redis cache if available,
   * while ensuring background tracking is active for the requested symbol.
   */
  public static async getDynamicMarketData(
    symbol: string,
    interval: string = "1h",
  ) {
    const formattedSymbol = symbol.trim().toUpperCase();
    const cleanRedisKey = `orion:live:${formattedSymbol.replace("/", "")}:${interval}`;

    // 1. Check if live data already exists in Redis cache
    const cachedData = await redisClient.get(cleanRedisKey);
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    // 2. If not cached, fetch it immediately via REST to satisfy the current request
    const candles = await MarketService.getCandles(
      formattedSymbol,
      interval,
      50,
    );
    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      throw new Error(
        `Failed to retrieve valid candle data for ${formattedSymbol}`,
      );
    }

    const latestCandle = candles[candles.length - 1];

    const marketPayload = {
      symbol: formattedSymbol,
      interval,
      assetType:
        formattedSymbol.includes("/") || formattedSymbol.length === 6
          ? "forex"
          : "crypto",
      latestPrice: latestCandle.close,
      candles,
      lastUpdated: new Date().toISOString(),
    };

    // Save to Redis cache
    await redisClient.set(cleanRedisKey, JSON.stringify(marketPayload));

    // 3. Dynamically spin up background tracking so subsequent requests are lightning-fast
    this.ensureBackgroundTracking(formattedSymbol, interval);

    return marketPayload;
  }

  private static ensureBackgroundTracking(symbol: string, interval: string) {
    const isCrypto = !symbol.includes("/") && symbol.length !== 6;

    if (isCrypto) {
      // Dynamic Crypto WebSocket Stream
      const streamId = `${symbol}:${interval}`;
      if (!this.activeCryptoStreams.has(streamId)) {
        console.log(
          `[Market Orchestrator]: Spawning dynamic Binance WebSocket for ${symbol}`,
        );

        CryptoWsService.subscribeToKline(
          symbol,
          interval,
          async (liveCandle: any) => {
            const redisKey = `orion:live:${symbol.replace("/", "")}:${interval}`;
            const cachedPayloadStr = await redisClient.get(redisKey);

            if (cachedPayloadStr) {
              try {
                const payload = JSON.parse(cachedPayloadStr);

                // Update latest price from live stream
                payload.latestPrice = liveCandle.close ?? payload.latestPrice;
                payload.lastUpdated = new Date().toISOString();

                // Optionally update the latest candle in the array or push it
                if (payload.candles && payload.candles.length > 0) {
                  payload.candles[payload.candles.length - 1] = liveCandle;
                }

                // Save the full, intact payload structure back to Redis
                await redisClient.set(redisKey, JSON.stringify(payload));
              } catch (err) {
                console.error("[WebSocket Cache Update Error]:", err);
              }
            }
          },
        );

        this.activeCryptoStreams.add(streamId);
      }
    } else {
      // Dynamic Forex Poller (Polled every 60s to protect rate limits)
      const pollerId = `${symbol}:${interval}`;
      if (!this.activeForexPollers.has(pollerId)) {
        console.log(
          `[Market Orchestrator]: Spawning dynamic Forex poller for ${symbol}`,
        );
        ForexPollerService.startPolling(symbol, interval, 60000);
        this.activeForexPollers.add(pollerId);
      }
    }
  }
}