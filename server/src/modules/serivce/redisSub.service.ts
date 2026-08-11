import { Server as SocketIOServer } from "socket.io";
import { redisSubClient } from "../../config/redis.js";

export async function initRedisSubscriptions(io: SocketIOServer) {
  await redisSubClient.subscribe("ORION_ALERTS", "ORION_INSIGHTS", "ORION_KLINES");

  redisSubClient.on("message", (channel, message) => {
    try {
      const payload = JSON.parse(message);

      if (channel === "ORION_ALERTS") {
        io.to(`user_${payload.userId}`).emit("alert_triggered", payload);
        console.log(`[Realtime Alert Pushed]: Broadcasted to user_${payload.userId}`);
      } else if (channel === "ORION_INSIGHTS") {
        const roomName = `symbol_${payload.symbol.toUpperCase().replace("/", "")}`;
        io.to(roomName).emit("ai_insight_updated", payload);
        console.log(`[Realtime Insight Pushed]: Broadcasted to ${roomName}`);
      } else if (channel === "ORION_KLINES") {
        const roomName = `symbol_${payload.symbol.toUpperCase().replace("/", "")}`;
        io.to(roomName).emit("kline_update", payload.candle);
      }
    } catch (err) {
      console.error("[Pub/Sub Event Handler Error]:", err);
    }
  });
}