import http from "http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app.js";
import pgPool from "./config/db.js";
import { ENV } from "./config/env.js";
import { AlertWorkerService } from "./modules/alert/alert.service.js";
import { initSocketHandlers } from "./sockets/index.js";
import { initRedisSubscriptions } from "./modules/serivce/redisSub.service.js";

const PORT = ENV.PORT || 8000;

// Wrap Express app inside HTTP server
const server = http.createServer(app);

// Initialize Socket.IO server
export const io = new SocketIOServer(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001", ENV.CLIENT_URL], // Add all frontend URLs
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  // Allow both WebSocket and polling
  transports: ["websocket", "polling"],
  // Increase ping timeout for slower connections
  pingTimeout: 60000,
  pingInterval: 25000,
});

const startServer = async () => {
  try {
    // 1. Verify PostgreSQL Database Connection
    const client = await pgPool.connect();
    const res = await client.query("SELECT NOW()");
    client.release();
    console.log(`[Database]: Connected to database at ${res.rows[0].now}`);

    // 2. Register Socket Event Handlers
    initSocketHandlers(io);

    // 3. Register Redis Pub/Sub Listener Channels
    await initRedisSubscriptions(io);

    // 4. Start Background Monitoring Worker (Pass 'io' instance here)
    AlertWorkerService.startAlertEngine(io, 10000);

    // 5. Start Server
    server.listen(PORT, () => {
      console.log(
        `[Server]: Orion intelligence engine running on port ${PORT} in ${ENV.NODE_ENV} mode`
      );
    });
  } catch (error: any) {
    console.error(`[Server Startup Error]: ${error}`);
    process.exit(1);
  }
};

startServer();