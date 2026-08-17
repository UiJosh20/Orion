// sockets/index.ts
import { Server as SocketIOServer, Socket } from "socket.io";
import {
  MarketService,
  MarketOrchestrator,
  MarketMathService,
} from "../modules/market/market.service.js";
import { AiInsightService } from "../modules/ai/ai.service.js";

const INSIGHT_REFRESH_MS = 5 * 60_000; // 5 min — was 60s; a fresh AI call every
// minute was the main source of setups changing when nothing real had moved.

interface InsightSubscriptionParams {
  symbol: string;
  interval: string;
  riskPercent: number;
  riskRewardRatio: number;
}

interface InsightRoomState {
  params: InsightSubscriptionParams;
  subscriberCount: number;
  timer: NodeJS.Timeout;
}

interface EmittedTradeSnapshot {
  side: string;
  entry: number;
  stopLoss: number;
  target: number;
}

const activeInsightRooms = new Map<string, InsightRoomState>();
// Last trade actually broadcast per room — used to suppress no-op re-emits
// caused by Gemini's own call-to-call variance rather than real market change.
const lastEmittedTrade = new Map<string, EmittedTradeSnapshot | null>();

function buildInsightRoomKey(p: InsightSubscriptionParams): string {
  return `insight:${p.symbol}:${p.interval}:${p.riskPercent}:${p.riskRewardRatio}`;
}

/**
 * Swing-lookback window scaled to the timeframe. A fixed 50-candle lookback
 * means 50 minutes on a 1m chart but 50 days on a 1d chart — wildly
 * different structural windows. Scaling this is what makes "discount/
 * premium" and swing-high/low actually mean the same thing across
 * timeframes instead of being arbitrary on anything but 1h.
 */
function getSwingLookback(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60,
    "5m": 60,
    "15m": 96,
    "30m": 96,
    "1h": 48,
    "2h": 60,
    "4h": 60,
    "1d": 60,
    "1w": 52,
    "1M": 24,
  };
  return map[interval] ?? 50;
}

function tradeChangedMeaningfully(
  key: string,
  next: EmittedTradeSnapshot | null,
): boolean {
  const prev = lastEmittedTrade.get(key);
  if (prev === undefined) return true;
  if (prev === null && next === null) return false;
  if (prev === null || next === null) return true;

  const pctDiff = (a: number, b: number) => Math.abs((a - b) / b) * 100;
  return (
    prev.side !== next.side ||
    pctDiff(prev.entry, next.entry) > 0.1 ||
    pctDiff(prev.stopLoss, next.stopLoss) > 0.1 ||
    pctDiff(prev.target, next.target) > 0.1
  );
}

async function generateInsightPayload(params: InsightSubscriptionParams) {
  const { symbol, interval, riskPercent, riskRewardRatio } = params;
  console.log(`[Insight] Starting generation for ${symbol} (${interval}, risk=${riskPercent}%, rr=${riskRewardRatio})`);

  const marketData = await MarketOrchestrator.getDynamicMarketData(symbol, interval);
  if (!marketData?.candles?.length) {
    throw new Error(`No candle data available for ${symbol}`);
  }
  console.log(`[Insight] Got ${marketData.candles.length} candles for ${symbol}, latest price ${marketData.latestPrice}`);

  const closes = marketData.candles.map((c) => c.close);
  const rsi = MarketMathService.calculateRSI(closes);
  const sma = MarketMathService.calculateSMA(closes, 20);
  const atr = MarketMathService.calculateATR(marketData.candles);
  const adx = MarketMathService.calculateADX(marketData.candles);
  const vwap = MarketMathService.calculateVWAP(marketData.candles);
  const bollingerBands = MarketMathService.calculateBollingerBands(marketData.candles);
  const swingLookback = getSwingLookback(interval);
  const swingRange = MarketMathService.findRecentSwingRange(marketData.candles, swingLookback);

  console.log(`[Insight] Telemetry computed (swing lookback=${swingLookback}):`, { rsi, sma, atr, adx, vwap });

  let volume24hChangePct: number | null = null;
  if (marketData.candles.length >= 25) {
    const recentVol = marketData.candles.slice(-24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
    const priorVol = marketData.candles.slice(-48, -24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
    if (priorVol > 0) {
      volume24hChangePct = Number((((recentVol - priorVol) / priorVol) * 100).toFixed(2));
    }
  }

  console.log(`[Insight] Calling Gemini for ${symbol}...`);
  const aiInsight = await AiInsightService.generateMarketInsight({
    symbol: marketData.symbol,
    interval,
    assetType: marketData.assetType,
    latestPrice: marketData.latestPrice,
    rsi,
    sma,
    atr,
    adx: adx?.adx ?? null,
    pdi: adx?.pdi ?? null,
    mdi: adx?.mdi ?? null,
    vwap: vwap ?? null,
    bollingerBands: bollingerBands ?? null,
    recentSwingHigh: swingRange.swingHigh,
    recentSwingLow: swingRange.swingLow,
    volume24hChangePct,
    newsHeadlines: marketData.headlines || [],
    fundingRate: null,
    riskPercent,
    riskRewardRatio,
  });
  console.log(`[Insight] Gemini responded for ${symbol}. confidence=${aiInsight.confidence}, hasTrade=${!!aiInsight.tradePosition}`);

  return {
    symbol: marketData.symbol,
    interval,
    latestPrice: marketData.latestPrice,
    indicators: { rsi, sma, atr, adx, vwap, bollingerBands, swingRange },
    volume24hChangePct,
    aiInsight,
    generatedAt: Date.now(),
  };
}

function ensureInsightRoomActive(io: SocketIOServer, params: InsightSubscriptionParams) {
  const key = buildInsightRoomKey(params);
  const existing = activeInsightRooms.get(key);

  if (existing) {
    existing.subscriberCount += 1;
    return;
  }

  const timer = setInterval(async () => {
    try {
      const payload = await generateInsightPayload(params);
      const trade = payload.aiInsight.tradePosition;

      if (!tradeChangedMeaningfully(key, trade)) {
        console.log(`[Insight Refresh] ${key}: no meaningful change, suppressing broadcast`);
        return;
      }

      lastEmittedTrade.set(key, trade);
      io.to(key).emit("insight_update", payload);
    } catch (err: any) {
      console.error(`[Insight Refresh Error] ${key}:`, err.message);
      io.to(key).emit("insight_error", { symbol: params.symbol, message: err.message });
    }
  }, INSIGHT_REFRESH_MS);

  activeInsightRooms.set(key, { params, subscriberCount: 1, timer });
}

function releaseInsightRoom(key: string) {
  const room = activeInsightRooms.get(key);
  if (!room) return;

  room.subscriberCount -= 1;
  if (room.subscriberCount <= 0) {
    clearInterval(room.timer);
    activeInsightRooms.delete(key);
    lastEmittedTrade.delete(key);
  }
}

export function initSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    console.log(`[WebSocket]: Client connected (${socket.id})`);

    const subscribedInsightKeys = new Set<string>();

    socket.on("join", (userId: string) => {
      if (!userId) return;
      const roomName = `user:${userId}`;
      socket.join(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} joined ${roomName}`);
      socket.emit("join_confirmed", { room: roomName, userId });
    });

    socket.on("join_user_room", (userId: string) => {
      if (!userId) return;
      const roomName = `user:${userId}`;
      socket.join(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} joined ${roomName}`);
    });

    socket.on(
      "get_older_klines",
      async ({ symbol, interval, beforeTime }: { symbol: string; interval: string; beforeTime: number }) => {
        if (!symbol || !beforeTime) return;
        const formattedSymbol = symbol.toUpperCase().trim();
        const activeInterval = interval || "1h";

        try {
          const older = await MarketService.getOlderHistoricalKlines(formattedSymbol, activeInterval, beforeTime, 200);
          socket.emit("klines_older", { symbol: formattedSymbol, interval: activeInterval, candles: older });
        } catch (err: any) {
          console.error(`[WebSocket Error]: Failed to fetch older klines for ${formattedSymbol}`, err);
          socket.emit("klines_older", { symbol: formattedSymbol, interval: activeInterval, candles: [] });
        }
      },
    );

    socket.on("subscribe_symbol", async (symbol: string, interval: string = "1h") => {
      if (!symbol) return;
      const formattedSymbol = symbol.toUpperCase().trim();
      const roomName = `symbol:${formattedSymbol.replace("/", "")}`;

      socket.join(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} subscribed to ${roomName}`);

      try {
        await MarketOrchestrator.getDynamicMarketData(formattedSymbol, interval);
      } catch (err) {
        console.error(`[WebSocket Error]: Failed to initialize tracking for ${formattedSymbol}`, err);
      }
    });

    socket.on("unsubscribe_symbol", (symbol: string) => {
      if (!symbol) return;
      const formattedSymbol = symbol.toUpperCase().trim();
      const roomName = `symbol:${formattedSymbol.replace("/", "")}`;
      socket.leave(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} unsubscribed from ${roomName}`);
    });

    socket.on("get_klines", async ({ symbol, interval }: { symbol: string; interval: string }) => {
      if (!symbol) return;
      const activeInterval = interval || "1h";

      try {
        console.log(`[WebSocket]: Fetching historical klines for ${symbol} (${activeInterval})`);
        const klines = await MarketService.getHistoricalKlines(symbol, activeInterval, 200);
        socket.emit("klines_history", klines);
        MarketOrchestrator.getDynamicMarketData(symbol, activeInterval).catch(() => {});
      } catch (err) {
        console.error(`[WebSocket Error]: Failed to fetch klines for ${symbol}`, err);
        socket.emit("klines_history", []);
      }
    });

    socket.on(
      "subscribe_insight",
      async (raw: { symbol: string; interval: string; riskPercent?: number; riskRewardRatio?: number }) => {
        console.log(`[WebSocket] Received subscribe_insight from ${socket.id}:`, raw);
        if (!raw?.symbol) {
          console.warn(`[WebSocket] subscribe_insight rejected — no symbol in payload`);
          return;
        }

        const params: InsightSubscriptionParams = {
          symbol: raw.symbol.toUpperCase().trim(),
          interval: raw.interval || "1h",
          riskPercent: raw.riskPercent ?? 1.0,
          riskRewardRatio: raw.riskRewardRatio ?? 2.0,
        };
        const key = buildInsightRoomKey(params);

        socket.join(key);
        subscribedInsightKeys.add(key);
        ensureInsightRoomActive(io, params);

        try {
          const payload = await generateInsightPayload(params);
          lastEmittedTrade.set(key, payload.aiInsight.tradePosition);
          console.log(`[WebSocket] Emitting insight_update to ${socket.id} for ${key}`);
          socket.emit("insight_update", payload);
        } catch (err: any) {
          console.error(`[WebSocket Error]: Failed to generate insight for ${key}`, err);
          socket.emit("insight_error", { symbol: params.symbol, message: err.message });
        }
      },
    );

    socket.on(
      "unsubscribe_insight",
      (raw: { symbol: string; interval: string; riskPercent?: number; riskRewardRatio?: number }) => {
        if (!raw?.symbol) return;

        const params: InsightSubscriptionParams = {
          symbol: raw.symbol.toUpperCase().trim(),
          interval: raw.interval || "1h",
          riskPercent: raw.riskPercent ?? 1.0,
          riskRewardRatio: raw.riskRewardRatio ?? 2.0,
        };
        const key = buildInsightRoomKey(params);

        socket.leave(key);
        subscribedInsightKeys.delete(key);
        releaseInsightRoom(key);
      },
    );

    socket.on("disconnect", () => {
      console.log(`[WebSocket]: Client disconnected (${socket.id})`);
      for (const key of subscribedInsightKeys) {
        releaseInsightRoom(key);
      }
      subscribedInsightKeys.clear();
    });
  });
}