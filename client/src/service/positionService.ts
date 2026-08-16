import { ENDPOINTS } from "../constants/endpoints";
import { api } from "../libs/api/client";

export interface UserPosition {
  id: string;
  user_id: string;
  symbol: string;
  interval: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  target: number;
  stopLoss: number;
  time: number;
  created_at?: string;
}

export interface CreatePositionPayload {
  userId: string;
  symbol: string;
  interval: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  target: number;
  stopLoss: number;
  time: number;
  createdAt?: number;
}

export const positionService = {
  getPositions: async (userId: string, symbol?: string): Promise<UserPosition[]> => {
    const url = symbol 
      ? `${ENDPOINTS.MARKET.POSITIONS}/${encodeURIComponent(userId)}?symbol=${encodeURIComponent(symbol)}`
      : `${ENDPOINTS.MARKET.POSITIONS}/${encodeURIComponent(userId)}`;
    const response = await api.get(url);
    return response.data;
  },

  savePosition: async (data: CreatePositionPayload): Promise<UserPosition> => {
    const response = await api.post(ENDPOINTS.MARKET.POSITIONS, data);
    return response.data;
  },

  // ✅ NEW: Update an existing position
  updatePosition: async (id: string, userId: string, data: CreatePositionPayload): Promise<UserPosition> => {
    // ✅ FIX: Prevent sending "undefined" to the backend
    if (!id || id === 'undefined' || id === 'null') {
      throw new Error('Cannot update position: ID is undefined or invalid');
    }

    const response = await api.put(`${ENDPOINTS.MARKET.POSITIONS}/${id}`, {
      userId,
      symbol: data.symbol,
      interval: data.interval,
      side: data.side,
      entry: data.entry,
      target: data.target,
      stopLoss: data.stopLoss,
      time: data.time,
      createdAt: data.createdAt,
    });
    return response.data;
  },

  deletePosition: async (id: string, userId: string): Promise<void> => {
    await api.delete(`${ENDPOINTS.MARKET.POSITIONS}/${id}`, {
      data: { userId }
    });
  },
};