import { RSI, SMA } from "technicalindicators";
import { ENV } from "../../config/env.js";
import axios from "axios";
import WebSocket from "ws";
import { redisClient } from "../../config/redis.js";
import { NewsService } from "../news/news.service.js";
import pgPool from "../../config/db.js";

const TWELVE_DATA_URL = "https://api.twelvedata.com";
const BINANCE_URL = "https://api.binance.com/api/v3";
const TWELVE_DATA_API_KEY = ENV.TWELVE_DATA_API_KEY;

export class MarketService {
  public static async getCandles(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 50
  ) {
    let formattedSymbol = symbol.trim().toUpperCase();

    const cryptoQuotes = ["USDT", "BTC", "ETH", "BNB", "BUSD", "USDC"];
    const isCrypto =
      cryptoQuotes.some((q) => formattedSymbol.endsWith(q)) ||
      formattedSymbol.includes("USDT");

    if (!isCrypto) {
      if (formattedSymbol.length === 6 && !formattedSymbol.includes("/")) {
        formattedSymbol = `${formattedSymbol.slice(0, 3)}/${formattedSymbol.slice(3)}`;
      }
      return await this.fetchTwelveDataForex(formattedSymbol, interval, limit);
    } else {
      const binanceSymbol = formattedSymbol.replace("/", "");
      return await this.fetchBinanceCrypto(binanceSymbol, interval, limit);
    }
  }

  /**
   * 👈 NEW: Returns historical candles with Unix timestamps in seconds
   * specifically formatted for TradingView Lightweight Charts.
   */
  public static async getHistoricalKlines(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 200
  ) {
    const candles = await this.getCandles(symbol, interval, limit);
    return candles.map((c: any) => ({
      time: Math.floor(new Date(c.datetime).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  }

  private static async fetchBinanceCrypto(
    symbol: string,
    interval: string,
    limit: number
  ) {
    try {
      const formattedSymbol = symbol.replace("/", "").toUpperCase();

      const response = await axios.get(`${BINANCE_URL}/klines`, {
        params: {
          symbol: formattedSymbol,
          interval,
          limit,
        },
      });

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
    limit: number
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
          response.data.message || `Failed to fetch forex data for ${symbol}`
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
    period: number = 14
  ): number[] {
    return RSI.calculate({ values: closingPrice, period });
  }

  public static calculateSMA(
    closingPrice: number[],
    period: number = 14
  ): number[] {
    return SMA.calculate({ values: closingPrice, period });
  }
}

export class CryptoWsService {
  private static ws: WebSocket | null = null;
  private static activeStreams: Set<string> = new Set();
  private static subscribers: Map<string, (candle: any) => void> = new Map();
  private static reconnectTimeout: NodeJS.Timeout | null = null;

  public static subscribeToKline(
    symbol: string,
    interval: string,
    callback: (candle: any) => void
  ) {
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    this.subscribers.set(streamName, callback);

    if (this.activeStreams.has(streamName)) {
      return;
    }

    this.activeStreams.add(streamName);

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connectMasterSocket();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      const subPayload = JSON.stringify({
        method: "SUBSCRIBE",
        params: [streamName],
        id: Date.now(),
      });
      this.ws.send(subPayload);
      console.log(`[Crypto WS]: Dynamically added stream -> ${streamName}`);
    }
  }

  private static connectMasterSocket() {
    if (this.activeStreams.size === 0) return;

    const streamsParam = Array.from(this.activeStreams).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streamsParam}`;

    console.log(`[Crypto WS]: Connecting to master multi-stream socket...`);
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log(`[Crypto WS]: Master connection established successfully.`);
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
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
        console.error("[Crypto WS Message Error]:", err);
      }
    });

    this.ws.on("close", () => {
      console.warn("[Crypto WS]: Master connection closed. Reconnecting in 5s...");
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[Crypto WS Error]:", err);
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

  public static startPolling(
    symbol: string = "EUR/USD",
    interval: string = "1h",
    frequencyMs: number = 60000
  ) {
    const formattedSymbol = symbol.toUpperCase();
    const pollerKey = `${formattedSymbol}:${interval}`;

    if (this.pollingIntervals.has(pollerKey)) {
      clearInterval(this.pollingIntervals.get(pollerKey)!);
    }

    console.log(
      `[Forex Poller]: Initialized background polling for ${formattedSymbol} every ${frequencyMs / 1000}s`
    );

    this.fetchAndCacheForex(formattedSymbol, interval);

    const intervalId = setInterval(async () => {
      await this.fetchAndCacheForex(formattedSymbol, interval);
    }, frequencyMs);

    this.pollingIntervals.set(pollerKey, intervalId);
  }

  private static async fetchAndCacheForex(symbol: string, interval: string) {
    try {
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

      const redisKey = `orion:live:${symbol.replace("/", "")}:${interval}`;
      await redisClient.set(redisKey, JSON.stringify(marketDataPayload));

      // 👈 Publish Forex update to Redis PubSub for Socket.IO clients
      const chartCandle = {
        time: Math.floor(new Date(latestCandle.datetime).getTime() / 1000),
        open: latestCandle.open,
        high: latestCandle.high,
        low: latestCandle.low,
        close: latestCandle.close,
      };

      await redisClient.publish(
        "ORION_KLINES",
        JSON.stringify({ symbol, interval, candle: chartCandle })
      );

      console.log(
        `[Forex Poller]: Successfully polled & cached ${symbol} -> Latest Close: ${latestCandle.close}`
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

  public static async getDynamicMarketData(
    symbol: string,
    interval: string = "1h"
  ) {
    const formattedSymbol = symbol.trim().toUpperCase();
    const cleanRedisKey = `orion:live:${formattedSymbol.replace("/", "")}:${interval}`;

    const cachedData = await redisClient.get(cleanRedisKey);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        if (
          parsed &&
          Array.isArray(parsed.candles) &&
          parsed.candles.length > 0
        ) {
          this.ensureBackgroundTracking(formattedSymbol, interval);
          return parsed;
        } else {
          console.warn(
            `[Market Orchestrator]: Malformed cache found for ${cleanRedisKey}. Purging...`
          );
          await redisClient.del(cleanRedisKey);
        }
      } catch (err) {
        await redisClient.del(cleanRedisKey);
      }
    }

    const [candles, headlines] = await Promise.all([
      MarketService.getCandles(formattedSymbol, interval, 50),
      NewsService.fetchNews(formattedSymbol),
    ]);

    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      throw new Error(
        `Failed to retrieve valid candle data for ${formattedSymbol}`
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
      headlines,
      lastUpdated: new Date().toISOString(),
    };

    await redisClient.set(cleanRedisKey, JSON.stringify(marketPayload));
    this.ensureBackgroundTracking(formattedSymbol, interval);

    return marketPayload;
  }

  private static ensureBackgroundTracking(symbol: string, interval: string) {
    const isCrypto = !symbol.includes("/") && symbol.length !== 6;

    if (isCrypto) {
      const streamId = `${symbol}:${interval}`;
      if (!this.activeCryptoStreams.has(streamId)) {
        console.log(
          `[Market Orchestrator]: Spawning dynamic Binance WebSocket for ${symbol}`
        );

        CryptoWsService.subscribeToKline(
          symbol,
          interval,
          async (liveCandle: any) => {
            const chartCandle = {
              time: Math.floor(liveCandle.timestamp / 1000),
              open: liveCandle.open,
              high: liveCandle.high,
              low: liveCandle.low,
              close: liveCandle.close,
            };

            // 👈 1. Publish real-time tick to Redis Pub/Sub channel (ORION_KLINES)
            await redisClient.publish(
              "ORION_KLINES",
              JSON.stringify({
                symbol,
                interval,
                candle: chartCandle,
              })
            );

            // 👈 2. Update KV cache in Redis
            const redisKey = `orion:live:${symbol.replace("/", "")}:${interval}`;
            const cachedPayloadStr = await redisClient.get(redisKey);

            if (cachedPayloadStr) {
              try {
                const payload = JSON.parse(cachedPayloadStr);
                if (payload && Array.isArray(payload.candles)) {
                  payload.latestPrice = liveCandle.close ?? payload.latestPrice;
                  payload.lastUpdated = new Date().toISOString();

                  if (payload.candles.length > 0) {
                    payload.candles[payload.candles.length - 1] = liveCandle;
                  }

                  await redisClient.set(redisKey, JSON.stringify(payload));
                }
              } catch (err) {
                console.error("[WebSocket Cache Update Error]:", err);
              }
            }
          }
        );

        this.activeCryptoStreams.add(streamId);
      }
    } else {
      const pollerId = `${symbol}:${interval}`;
      if (!this.activeForexPollers.has(pollerId)) {
        console.log(
          `[Market Orchestrator]: Spawning dynamic Forex poller for ${symbol}`
        );
        ForexPollerService.startPolling(symbol, interval, 60000);
        this.activeForexPollers.add(pollerId);
      }
    }
  }
}

export class MarketWatchList {
  public static async getSupportedSymbols(category?: string) {
    let query = 'SELECT symbol, name, category, exchange FROM supported_symbols';
    const params: string[] = [];

    if (category) {
      query += ' WHERE LOWER(category) = $1';
      params.push(category.toLowerCase());
    }

    const { rows } = await pgPool.query(query, params);

    if (!category) {
      return {
        crypto: rows.filter((r) => r.category === 'crypto'),
        forex: rows.filter((r) => r.category === 'forex'),
      };
    }

    return { symbols: rows };
  }

  public static async getUserWatchlist(userId: string | any) {
    const query = `
      SELECT s.symbol, s.name, s.category, s.exchange 
      FROM user_watchlist w
      JOIN supported_symbols s ON w.symbol = s.symbol
      WHERE w.user_id = $1
    `;
    const { rows } = await pgPool.query(query, [userId]);
    return rows;
  }

  public static async addToWatchlist(userId: string, symbol: string) {
    const query = `
      INSERT INTO user_watchlist (user_id, symbol)
      VALUES ($1, $2)
      ON CONFLICT (user_id, symbol) DO NOTHING
      RETURNING *;
    `;
    const { rows } = await pgPool.query(query, [userId, symbol]);
    return rows[0];
  }
}