// sockets/index.ts
import { Server as SocketIOServer, Socket } from "socket.io";
import {
  MarketService,
  MarketOrchestrator,
  MarketMathService,
} from "../modules/market/market.service.js";
import { AiInsightService } from "../modules/ai/ai.service.js";

const INSIGHT_REFRESH_MS = 60_000; // regenerate at most once a minute per subscribed config

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

// One entry per unique symbol:interval:riskPercent:riskRewardRatio combo
// currently being watched by at least one connected client.
const activeInsightRooms = new Map<string, InsightRoomState>();

function buildInsightRoomKey(p: InsightSubscriptionParams): string {
  return `insight:${p.symbol}:${p.interval}:${p.riskPercent}:${p.riskRewardRatio}`;
}

async function generateInsightPayload(params: InsightSubscriptionParams) {
  const { symbol, interval, riskPercent, riskRewardRatio } = params;
  console.log(
    `[Insight] Starting generation for ${symbol} (${interval}, risk=${riskPercent}%, rr=${riskRewardRatio})`,
  );

  const marketData = await MarketOrchestrator.getDynamicMarketData(
    symbol,
    interval,
  );
  if (!marketData?.candles?.length) {
    throw new Error(`No candle data available for ${symbol}`);
  }
  console.log(
    `[Insight] Got ${marketData.candles.length} candles for ${symbol}, latest price ${marketData.latestPrice}`,
  );

  const telemetry = MarketMathService.getComprehensiveTelemetry(
    marketData.candles,
  );
  console.log(`[Insight] Telemetry computed:`, {
    rsi: telemetry.rsi,
    sma: telemetry.sma,
    atr: telemetry.atr,
    adx: telemetry.adx,
    vwap: telemetry.vwap,
  });

  let volume24hChangePct: number | null = null;
  if (marketData.candles.length >= 25) {
    const recentVol = marketData.candles
      .slice(-24)
      .reduce((s: number, c: any) => s + (c.volume || 0), 0);
    const priorVol = marketData.candles
      .slice(-48, -24)
      .reduce((s: number, c: any) => s + (c.volume || 0), 0);
    if (priorVol > 0) {
      volume24hChangePct = Number(
        (((recentVol - priorVol) / priorVol) * 100).toFixed(2),
      );
    }
  }

  console.log(`[Insight] Calling Gemini for ${symbol}...`);
  const aiInsight = await AiInsightService.generateMarketInsight({
    symbol: marketData.symbol,
    interval,
    assetType: marketData.assetType,
    latestPrice: marketData.latestPrice,
    rsi: telemetry.rsi,
    sma: telemetry.sma,
    atr: telemetry.atr,
    adx: telemetry.adx?.adx ?? null,
    pdi: telemetry.adx?.pdi ?? null,
    mdi: telemetry.adx?.mdi ?? null,
    vwap: telemetry.vwap ?? null,
    bollingerBands: telemetry.bollingerBands ?? null,
    recentSwingHigh: telemetry.swingRange.swingHigh,
    recentSwingLow: telemetry.swingRange.swingLow,
    volume24hChangePct,
    newsHeadlines: marketData.headlines || [],
    fundingRate: null,
    riskPercent,
    riskRewardRatio,
  });
  console.log(
    `[Insight] Gemini responded for ${symbol}. confidence=${aiInsight.confidence}, hasTrade=${!!aiInsight.tradePosition}`,
  );

  return {
    symbol: marketData.symbol,
    interval,
    latestPrice: marketData.latestPrice,
    indicators: telemetry,
    volume24hChangePct,
    aiInsight,
    generatedAt: Date.now(),
  };
}

/**
 * Starts (or reuses) a background refresh loop for a given subscription key.
 * Only one Gemini call runs per unique config per refresh window, no matter
 * how many clients are watching it — the broadcast fans out to the room.
 */
function ensureInsightRoomActive(
  io: SocketIOServer,
  params: InsightSubscriptionParams,
) {
  const key = buildInsightRoomKey(params);
  const existing = activeInsightRooms.get(key);

  if (existing) {
    existing.subscriberCount += 1;
    return;
  }

  const timer = setInterval(async () => {
    try {
      const payload = await generateInsightPayload(params);
      io.to(key).emit("insight_update", payload);
    } catch (err: any) {
      console.error(`[Insight Refresh Error] ${key}:`, err.message);
      io.to(key).emit("insight_error", {
        symbol: params.symbol,
        message: err.message,
      });
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
  }
}

export function initSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    console.log(`[WebSocket]: Client connected (${socket.id})`);

    // Track which insight room keys this socket is subscribed to, so we
    // can clean up properly on disconnect without leaking intervals.
    const subscribedInsightKeys = new Set<string>();

    // 1. Personal Room Subscription for private alerts
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

    // Pagination for panning back in time — fetches candles strictly
    // older than `beforeTime` and returns them separately from the
    // initial history load, so the client can prepend + merge.
    socket.on(
      "get_older_klines",
      async ({
        symbol,
        interval,
        beforeTime,
      }: {
        symbol: string;
        interval: string;
        beforeTime: number;
      }) => {
        if (!symbol || !beforeTime) return;
        const formattedSymbol = symbol.toUpperCase().trim();
        const activeInterval = interval || "1h";

        try {
          const older = await MarketService.getOlderHistoricalKlines(
            formattedSymbol,
            activeInterval,
            beforeTime,
            200,
          );
          socket.emit("klines_older", {
            symbol: formattedSymbol,
            interval: activeInterval,
            candles: older,
          });
        } catch (err: any) {
          console.error(
            `[WebSocket Error]: Failed to fetch older klines for ${formattedSymbol}`,
            err,
          );
          socket.emit("klines_older", {
            symbol: formattedSymbol,
            interval: activeInterval,
            candles: [],
          });
        }
      },
    );

    // 2. Chart Room Subscription (candles)
    socket.on(
      "subscribe_symbol",
      async (symbol: string, interval: string = "1h") => {
        if (!symbol) return;
        const formattedSymbol = symbol.toUpperCase().trim();
        const roomName = `symbol:${formattedSymbol.replace("/", "")}`;

        socket.join(roomName);
        console.log(
          `[WebSocket]: Socket ${socket.id} subscribed to ${roomName}`,
        );

        try {
          await MarketOrchestrator.getDynamicMarketData(
            formattedSymbol,
            interval,
          );
        } catch (err) {
          console.error(
            `[WebSocket Error]: Failed to initialize tracking for ${formattedSymbol}`,
            err,
          );
        }
      },
    );

    socket.on("unsubscribe_symbol", (symbol: string) => {
      if (!symbol) return;
      const formattedSymbol = symbol.toUpperCase().trim();
      const roomName = `symbol:${formattedSymbol.replace("/", "")}`;
      socket.leave(roomName);
      console.log(
        `[WebSocket]: Socket ${socket.id} unsubscribed from ${roomName}`,
      );
    });

    // 3. Historical klines
    socket.on(
      "get_klines",
      async ({ symbol, interval }: { symbol: string; interval: string }) => {
        if (!symbol) return;
        const activeInterval = interval || "1h";

        try {
          console.log(
            `[WebSocket]: Fetching historical klines for ${symbol} (${activeInterval})`,
          );
          const klines = await MarketService.getHistoricalKlines(
            symbol,
            activeInterval,
            200,
          );
          socket.emit("klines_history", klines);
          MarketOrchestrator.getDynamicMarketData(symbol, activeInterval).catch(
            () => {},
          );
        } catch (err) {
          console.error(
            `[WebSocket Error]: Failed to fetch klines for ${symbol}`,
            err,
          );
          socket.emit("klines_history", []);
        }
      },
    );

    // 4. AI Insight Subscription — push-based, no REST polling required.
    // Client subscribes once per (symbol, interval, riskPercent, riskRewardRatio)
    // combo; gets an immediate payload, then periodic pushes as long as
    // at least one client is watching that exact config.
    socket.on(
      "subscribe_insight",
      async (raw: {
        symbol: string;
        interval: string;
        riskPercent?: number;
        riskRewardRatio?: number;
      }) => {
        console.log(
          `[WebSocket] Received subscribe_insight from ${socket.id}:`,
          raw,
        );
        if (!raw?.symbol) {
          console.warn(
            `[WebSocket] subscribe_insight rejected — no symbol in payload`,
          );
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
          console.log(
            `[WebSocket] Emitting insight_update to ${socket.id} for ${key}`,
          );
          socket.emit("insight_update", payload);
        } catch (err: any) {
          console.error(
            `[WebSocket Error]: Failed to generate insight for ${key}`,
            err,
          );
          socket.emit("insight_error", {
            symbol: params.symbol,
            message: err.message,
          });
        }
      },
    );

    socket.on(
      "unsubscribe_insight",
      (raw: {
        symbol: string;
        interval: string;
        riskPercent?: number;
        riskRewardRatio?: number;
      }) => {
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

    // 5. Disconnect cleanup
    socket.on("disconnect", () => {
      console.log(`[WebSocket]: Client disconnected (${socket.id})`);
      // Release every insight room this socket was still subscribed to,
      // so intervals for abandoned configs actually get cleared.
      for (const key of subscribedInsightKeys) {
        releaseInsightRoom(key);
      }
      subscribedInsightKeys.clear();
    });
  });
}
