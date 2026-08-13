// src/providers/SocketProvider.tsx
"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export function SocketProvider({ 
  children, 
  userId 
}: { 
  children: React.ReactNode; 
  userId?: string; 
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const hasJoinedRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Skip if no userId
    if (!userId) {
      console.log("[Socket]: No userId provided, waiting for user...");
      return;
    }

    console.log(`[Socket]: Initializing connection for user: ${userId}`);

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8000";
    console.log(`[Socket]: Connecting to ${socketUrl}`);

    const socketInstance = io(socketUrl, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
    });

    socketRef.current = socketInstance;

    // Connection events
    socketInstance.on("connect", () => {
      console.log("[Socket]: Connected to server with ID:", socketInstance.id);
      setIsConnected(true);
      reconnectAttempts.current = 0;
      
      // Join user room
      if (userId && !hasJoinedRef.current) {
        socketInstance.emit("join", userId);
        hasJoinedRef.current = true;
        console.log(`[Socket]: Emitted join event for user: ${userId}`);
      }
    });

    socketInstance.on("connect_error", (error) => {
      console.error("[Socket]: Connection error:", error.message);
      setIsConnected(false);
      
      reconnectAttempts.current++;
      if (reconnectAttempts.current >= maxReconnectAttempts) {
        console.error("[Socket]: Max reconnection attempts reached");
        socketInstance.disconnect();
      }
    });

    socketInstance.on("disconnect", (reason) => {
      console.log(`[Socket]: Disconnected from server (${reason})`);
      setIsConnected(false);
      hasJoinedRef.current = false;
    });

    socketInstance.on("reconnect", (attemptNumber) => {
      console.log(`[Socket]: Reconnected after ${attemptNumber} attempts`);
      setIsConnected(true);
      
      // Re-join user room after reconnection
      if (userId && !hasJoinedRef.current) {
        socketInstance.emit("join", userId);
        hasJoinedRef.current = true;
        console.log(`[Socket]: Re-joined user room -> user:${userId}`);
      }
    });

    socketInstance.on("reconnect_attempt", (attempt) => {
      console.log(`[Socket]: Reconnection attempt ${attempt}`);
    });

    socketInstance.on("reconnect_error", (error) => {
      console.error("[Socket]: Reconnection error:", error.message);
    });

    // Alert event listener
    socketInstance.on("alert_triggered", (data: {
      id: string;
      symbol: string;
      price: number;
      condition: string;
      threshold: number;
      timestamp?: string;
    }) => {
      console.log("[Socket] 🚨 ALERT RECEIVED:", data);
      
      // Dispatch custom event for the TriggeredAlertBanner
      const event = new CustomEvent("orion_alert_triggered", {
        detail: data,
      });
      window.dispatchEvent(event);
    });

    // Join confirmation
    socketInstance.on("join_confirmed", (data) => {
      console.log("[Socket]: Join confirmed:", data);
      hasJoinedRef.current = true;
    });

    // Also listen for global alerts
    socketInstance.on("alert_triggered_global", (data) => {
      console.log("[Socket] 🌐 Global alert received:", data);
    });

    setSocket(socketInstance);

    return () => {
      console.log("[Socket]: Cleaning up...");
      if (socketInstance) {
        socketInstance.off("connect");
        socketInstance.off("connect_error");
        socketInstance.off("disconnect");
        socketInstance.off("reconnect");
        socketInstance.off("reconnect_attempt");
        socketInstance.off("reconnect_error");
        socketInstance.off("alert_triggered");
        socketInstance.off("alert_triggered_global");
        socketInstance.off("join_confirmed");
        socketInstance.disconnect();
        socketRef.current = null;
        hasJoinedRef.current = false;
      }
    };
  }, [userId]); // Re-run when userId changes

  // Debug: Log connection status changes
  useEffect(() => {
    console.log("[Socket]: Connection status:", isConnected ? "✅ Connected" : "❌ Disconnected");
  }, [isConnected]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    console.warn("[Socket]: useSocket must be used within a SocketProvider");
  }
  return context;
};