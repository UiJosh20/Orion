// sockets/index.ts
import { Server as SocketIOServer, Socket } from "socket.io";
import { MarketService, MarketOrchestrator } from "../modules/market/market.service.js";

export function initSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    console.log(`[WebSocket]: Client connected (${socket.id})`);

    // 1. Personal Room Subscription for private alerts
    socket.on("join", (userId: string) => {
      if (!userId) return;
      // Use consistent room naming with colon
      const roomName = `user:${userId}`;
      socket.join(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} joined ${roomName}`);
      
      // Send confirmation back
      socket.emit("join_confirmed", { room: roomName, userId });
    });

    // Also support the old event name for backward compatibility
    socket.on("join_user_room", (userId: string) => {
      if (!userId) return;
      const roomName = `user:${userId}`;
      socket.join(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} joined ${roomName}`);
    });

    // 2. Chart Room Subscription (Spawns background tracking if not already active)
    socket.on("subscribe_symbol", async (symbol: string, interval: string = "1h") => {
      if (!symbol) return;
      const formattedSymbol = symbol.toUpperCase().trim();
      const roomName = `symbol:${formattedSymbol.replace("/", "")}`;

      socket.join(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} subscribed to ${roomName}`);

      try {
        // Ensures live tracking (Crypto WS or Forex Poller) is running in the background
        await MarketOrchestrator.getDynamicMarketData(formattedSymbol, interval);
      } catch (err) {
        console.error(`[WebSocket Error]: Failed to initialize tracking for ${formattedSymbol}`, err);
      }
    });

    // 3. Unsubscribe from Chart Room
    socket.on("unsubscribe_symbol", (symbol: string) => {
      if (!symbol) return;
      const formattedSymbol = symbol.toUpperCase().trim();
      const roomName = `symbol:${formattedSymbol.replace("/", "")}`;

      socket.leave(roomName);
      console.log(`[WebSocket]: Socket ${socket.id} unsubscribed from ${roomName}`);
    });

    // 4. Request Historical Klines (Formatted with Unix timestamps in seconds)
    socket.on("get_klines", async ({ symbol, interval }: { symbol: string; interval: string }) => {
      if (!symbol) return;
      const activeInterval = interval || "1h";

      try {
        console.log(`[WebSocket]: Fetching historical klines for ${symbol} (${activeInterval})`);

        // Fetch past 200 candles pre-formatted for Lightweight Charts ({ time, open, high, low, close })
        const klines = await MarketService.getHistoricalKlines(symbol, activeInterval, 200);

        // Emit historical snapshot array back to requesting socket
        socket.emit("klines_history", klines);

        // Ensure live streaming pipeline is initialized for this pair
        MarketOrchestrator.getDynamicMarketData(symbol, activeInterval).catch(() => {});
      } catch (err) {
        console.error(`[WebSocket Error]: Failed to fetch klines for ${symbol}`, err);
        socket.emit("klines_history", []);
      }
    });

    // 5. Handle Socket Disconnect
    socket.on("disconnect", () => {
      console.log(`[WebSocket]: Client disconnected (${socket.id})`);
    });
  });
}