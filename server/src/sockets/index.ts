// sockets/index.ts
import { Server as SocketIOServer, Socket } from "socket.io";
import {
  MarketService,
  MarketOrchestrator,
  MarketMathService,
} from "../modules/market/market.service.js";
import { AiInsightService } from "../modules/ai/ai.service.js";

// ==========================================
// ICT & Market Structure Helpers
// ==========================================

interface MStructure {
  swingHigh: number | null;
  swingLow: number | null;
  bullishBOS: boolean; // Break of Structure
  bearishBOS: boolean;
  fvgAbove: number | null; // Fair Value Gap
  fvgBelow: number | null;
  orderBlockAbove: number | null;
  orderBlockBelow: number | null;
}

// NEW — equal highs/lows + sweep detection.
interface LiquidityContext {
  equalHighs: number | null;
  equalLows: number | null;
  recentSweepHigh: boolean;
  recentSweepLow: boolean;
}

// NEW — minimal higher-timeframe snapshot.
interface HigherTimeframeContext {
  interval: string;
  price: number;
  sma: number | null;
  biasLabel: "BULLISH" | "BEARISH" | "NEUTRAL";
}

/**
 * Analyzes the last 50 candles for Smart Money Concepts (ICT).
 * - Break of Structure (BOS): High/Low breaks.
 * - Fair Value Gaps (FVG): 3-candle gaps.
 * - Order Blocks: Last candle before a strong impulse move.
 */
function analyzeMarketStructure(candles: any[]): MStructure {
  if (candles.length < 10) {
    return {
      swingHigh: null,
      swingLow: null,
      bullishBOS: false,
      bearishBOS: false,
      fvgAbove: null,
      fvgBelow: null,
      orderBlockAbove: null,
      orderBlockBelow: null,
    };
  }

  // 1. Find Swing Highs and Lows (Fractals)
  let swingHigh = null;
  let swingLow = null;
  const window = candles.slice(-20); // Lookback 20 candles for structure
  for (let i = 5; i < window.length - 5; i++) {
    const high = window[i].high;
    const low = window[i].low;
    const prevHighs = window.slice(i - 5, i).map((c) => c.high);
    const nextHighs = window.slice(i + 1, i + 6).map((c) => c.high);
    if (high > Math.max(...prevHighs) && high > Math.max(...nextHighs)) {
      swingHigh = high;
    }
    if (low < Math.min(...prevHighs) && low < Math.min(...nextHighs)) {
      swingLow = low;
    }
  }

  // 2. Detect Break of Structure (BOS)
  const lastCandle = candles[candles.length - 1];
  const bullishBOS = lastCandle.close > (swingHigh || 0);
  const bearishBOS = lastCandle.close < (swingLow || Infinity);

  // 3. Detect Fair Value Gaps (FVG) - 3 candle pattern
  let fvgAbove = null;
  let fvgBelow = null;
  if (candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c3 = candles[candles.length - 1];
    if (c1.high < c3.low) fvgAbove = (c1.high + c3.low) / 2;
    if (c1.low > c3.high) fvgBelow = (c1.low + c3.high) / 2;
  }

  // 4. Detect Order Blocks (OB)
  let orderBlockAbove = null;
  let orderBlockBelow = null;
  for (let i = candles.length - 10; i < candles.length - 2; i++) {
    if (candles[i].close < candles[i].open && candles[i + 1].close > candles[i + 1].open) {
      orderBlockBelow = candles[i].low;
    }
    if (candles[i].close > candles[i].open && candles[i + 1].close < candles[i + 1].open) {
      orderBlockAbove = candles[i].high;
    }
  }

  return { swingHigh, swingLow, bullishBOS, bearishBOS, fvgAbove, fvgBelow, orderBlockAbove, orderBlockBelow };
}

/**
 * Detects equal highs/lows (liquidity pools) within a lookback window,
 * and whether the most recent candles swept one of those pools and
 * closed back on the other side (a stop-hunt / liquidity grab).
 *
 * "Equal" uses a small tolerance band (0.1% of price) since real equal
 * highs/lows are rarely pixel-perfect identical.
 */
function analyzeLiquidity(candles: any[]): LiquidityContext {
  if (candles.length < 15) {
    return { equalHighs: null, equalLows: null, recentSweepHigh: false, recentSweepLow: false };
  }

  const window = candles.slice(-30, -3); // exclude the very latest few candles — those are checked separately for the sweep itself
  const lastFew = candles.slice(-3);
  const lastCandle = candles[candles.length - 1];

  const tolerance = (lastCandle.close || 1) * 0.001;

  const clusterLevels = (values: number[]): number | null => {
    // Find the value with the most "near neighbors" within tolerance —
    // a crude but cheap way to find a repeated level without full clustering.
    let best: number | null = null;
    let bestCount = 0;
    for (const v of values) {
      const count = values.filter((o) => Math.abs(o - v) <= tolerance).length;
      if (count > bestCount) {
        bestCount = count;
        best = v;
      }
    }
    return bestCount >= 2 ? best : null;
  };

  const equalHighs = clusterLevels(window.map((c) => c.high));
  const equalLows = clusterLevels(window.map((c) => c.low));

  // Sweep = a wick beyond the pool, but the close comes back inside it.
  const recentSweepHigh =
    equalHighs != null &&
    lastFew.some((c) => c.high > equalHighs + tolerance) &&
    lastCandle.close < equalHighs;

  const recentSweepLow =
    equalLows != null &&
    lastFew.some((c) => c.low < equalLows - tolerance) &&
    lastCandle.close > equalLows;

  return { equalHighs, equalLows, recentSweepHigh, recentSweepLow };
}

/**
 * Maps an active trading interval to a sensible higher timeframe to pull
 * bias context from — roughly a 4-6x zoom-out.
 */
function getHigherTimeframeInterval(interval: string): string {
  const map: Record<string, string> = {
    "1m": "15m", "5m": "1h", "15m": "4h", "30m": "4h",
    "1h": "4h", "2h": "1d", "4h": "1d", "1d": "1w", "1w": "1M", "1M": "1M",
  };
  return map[interval] ?? "4h";
}

/**
 * Rough session windows in UTC. Good enough for weighting setup
 * reliability — doesn't need to be exact to the minute.
 */
function getSessionLabel(date: Date = new Date()): "ASIA" | "LONDON" | "NY_AM" | "NY_PM" | "OFF_SESSION" {
  const h = date.getUTCHours();
  if (h >= 0 && h < 7) return "ASIA";
  if (h >= 7 && h < 12) return "LONDON";
  if (h >= 12 && h < 16) return "NY_AM";
  if (h >= 16 && h < 20) return "NY_PM";
  return "OFF_SESSION";
}

// ==========================================
// AI & Socket Engine
// ==========================================

const INSIGHT_REFRESH_MS = 5000; // Check structure every 5 seconds
const INSIGHT_COOLDOWN_MS = 60000; // Only generate AI insight every 60 seconds

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
  lastGenerated: number;
}

interface EmittedTradeSnapshot {
  side: string;
  entry: number;
  stopLoss: number;
  target: number;
}

const activeInsightRooms = new Map<string, InsightRoomState>();
const lastEmittedTrade = new Map<string, EmittedTradeSnapshot | null>();
const lastStructure = new Map<string, MStructure | null>();

function buildInsightRoomKey(p: InsightSubscriptionParams): string {
  return `insight:${p.symbol}:${p.interval}:${p.riskPercent}:${p.riskRewardRatio}`;
}

function getSwingLookback(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60, "5m": 60, "15m": 96, "30m": 96,
    "1h": 48, "2h": 60, "4h": 60, "1d": 60, "1w": 52, "1M": 24,
  };
  return map[interval] ?? 50;
}

/**
 * Fetches higher-timeframe candles and derives a simple bias label.
 * Failure here should never block the main insight — HTF context is a
 * confluence factor, not a hard dependency.
 */
async function getHigherTimeframeContext(symbol: string, activeInterval: string): Promise<HigherTimeframeContext | null> {
  const htfInterval = getHigherTimeframeInterval(activeInterval);
  if (htfInterval === activeInterval) return null;

  try {
    const htfData = await MarketOrchestrator.getDynamicMarketData(symbol, htfInterval);
    if (!htfData?.candles?.length) return null;

    const closes = htfData.candles.map((c) => c.close);
    const sma = MarketMathService.calculateSMA(closes, 20);
    const price = htfData.latestPrice;

    let biasLabel: HigherTimeframeContext["biasLabel"] = "NEUTRAL";
    if (sma != null) {
      if (price > sma * 1.001) biasLabel = "BULLISH";
      else if (price < sma * 0.999) biasLabel = "BEARISH";
    }

    return { interval: htfInterval, price, sma, biasLabel };
  } catch (err: any) {
    console.warn(`[Insight] HTF context fetch failed for ${symbol} (${htfInterval}):`, err?.message);
    return null;
  }
}

async function generateInsightPayload(params: InsightSubscriptionParams) {
  const { symbol, interval, riskPercent, riskRewardRatio } = params;
  console.log(`[Insight] Starting generation for ${symbol} (${interval}, risk=${riskPercent}%, rr=${riskRewardRatio})`);

  const marketData = await MarketOrchestrator.getDynamicMarketData(symbol, interval);
  if (!marketData?.candles?.length) {
    throw new Error(`No candle data available for ${symbol}`);
  }

  const closes = marketData.candles.map((c) => c.close);
  const rsi = MarketMathService.calculateRSI(closes);
  const sma = MarketMathService.calculateSMA(closes, 20);
  const atr = MarketMathService.calculateATR(marketData.candles);
  const adx = MarketMathService.calculateADX(marketData.candles);
  const vwap = MarketMathService.calculateVWAP(marketData.candles);
  const bollingerBands = MarketMathService.calculateBollingerBands(marketData.candles);
  const swingLookback = getSwingLookback(interval);
  const swingRange = MarketMathService.findRecentSwingRange(marketData.candles, swingLookback);

  // ****** Market Structure Analysis ******
  const structure = analyzeMarketStructure(marketData.candles);
  const currentKey = `${symbol}:${interval}`;
  const previousStructure = lastStructure.get(currentKey);
  lastStructure.set(currentKey, structure);

  // ****** NEW: Liquidity Analysis ******
  const liquidity = analyzeLiquidity(marketData.candles);

  // Only proceed to AI if a Break of Structure (BOS) occurred, a gap was
  // filled, or a liquidity sweep just happened — a sweep is often the
  // earliest, most actionable signal, so it's added as its own trigger.
  const shouldTriggerAI =
    (structure.bullishBOS && previousStructure?.bullishBOS === false) ||
    (structure.bearishBOS && previousStructure?.bearishBOS === false) ||
    (structure.fvgAbove && structure.fvgAbove !== previousStructure?.fvgAbove) ||
    (structure.fvgBelow && structure.fvgBelow !== previousStructure?.fvgBelow) ||
    liquidity.recentSweepHigh ||
    liquidity.recentSweepLow;

  if (!shouldTriggerAI) {
    throw new Error(`No structural change detected for ${symbol}. Skipping AI generation.`);
  }

  let volume24hChangePct: number | null = null;
  if (marketData.candles.length >= 25) {
    const recentVol = marketData.candles.slice(-24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
    const priorVol = marketData.candles.slice(-48, -24).reduce((s: number, c: any) => s + (c.volume || 0), 0);
    if (priorVol > 0) {
      volume24hChangePct = Number((((recentVol - priorVol) / priorVol) * 100).toFixed(2));
    }
  }

  // ****** NEW: Higher-timeframe bias (fetched in parallel, non-blocking on failure) ******
  const higherTimeframe = await getHigherTimeframeContext(symbol, interval);
  const sessionLabel = getSessionLabel();

  console.log(
    `[Insight] Structural change detected for ${symbol}. sweepHigh=${liquidity.recentSweepHigh} sweepLow=${liquidity.recentSweepLow} htfBias=${higherTimeframe?.biasLabel ?? "N/A"} session=${sessionLabel}. Calling Gemini...`,
  );

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
    structure: {
      bullishBOS: structure.bullishBOS,
      bearishBOS: structure.bearishBOS,
      fvgAbove: structure.fvgAbove,
      fvgBelow: structure.fvgBelow,
      orderBlockAbove: structure.orderBlockAbove,
      orderBlockBelow: structure.orderBlockBelow,
    },
    // NEW inputs
    liquidity,
    higherTimeframe,
    sessionLabel,
  });
  console.log(
    `[Insight] Gemini responded for ${symbol}. confidence=${aiInsight.confidence}, confluence=${aiInsight.confluenceScore}/6, hasTrade=${!!aiInsight.tradePosition}`,
  );

  return {
    symbol: marketData.symbol,
    interval,
    latestPrice: marketData.latestPrice,
    indicators: { rsi, sma, atr, adx, vwap, bollingerBands, swingRange, structure },
    liquidity,
    higherTimeframe,
    sessionLabel,
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
    const room = activeInsightRooms.get(key);
    if (!room) return;

    if (Date.now() - room.lastGenerated < INSIGHT_COOLDOWN_MS) return;

    try {
      const payload = await generateInsightPayload(params);
      const trade = payload.aiInsight.tradePosition;

      room.lastGenerated = Date.now();

      if (trade !== null) {
        const prev = lastEmittedTrade.get(key);
        if (JSON.stringify(prev) !== JSON.stringify(trade)) {
          lastEmittedTrade.set(key, trade);
          io.to(key).emit("insight_update", payload);
        }
      }
    } catch (err: any) {
      if (!err.message.includes("No structural change")) {
        console.error(`[Insight Refresh Error] ${key}:`, err.message);
        io.to(key).emit("insight_error", { symbol: params.symbol, message: err.message });
      }
    }
  }, INSIGHT_REFRESH_MS);

  activeInsightRooms.set(key, { params, subscriberCount: 1, timer, lastGenerated: 0 });
}

function releaseInsightRoom(key: string) {
  const room = activeInsightRooms.get(key);
  if (!room) return;

  room.subscriberCount -= 1;
  if (room.subscriberCount <= 0) {
    clearInterval(room.timer);
    activeInsightRooms.delete(key);
    lastEmittedTrade.delete(key);
    lastStructure.delete(key);
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