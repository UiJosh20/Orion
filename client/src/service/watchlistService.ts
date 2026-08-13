import { ENDPOINTS } from "../constants/endpoints";
import { api } from "../libs/api/client";


export interface WatchlistItem {
  id: number;
  symbol: string;
  name?: string;
  price?: number;
  change24h?: number;
  created_at?: string;
}

export const watchlistService = {
  /**
   * Fetch watchlist items for either a logged-in user or anonymous device UUID
   */
  getWatchlist: async (userId: string): Promise<WatchlistItem[]> => {
    if (!userId) return [];
    const response = await api.get(ENDPOINTS.WATCHLIST.GET(userId));
    return response.data;
  },

  /**
   * Add a symbol to the current active session's watchlist
   */
  addToWatchlist: async (userId: string, symbol: string): Promise<WatchlistItem> => {
    const response = await api.post(ENDPOINTS.WATCHLIST.ADD, { userId, symbol });
    return response.data;
  },

  /**
   * Remove a symbol from the watchlist
   */
  removeFromWatchlist: async (userId: string, symbol: string): Promise<void> => {
    await api.delete(ENDPOINTS.WATCHLIST.REMOVE(userId, symbol));
  },
};