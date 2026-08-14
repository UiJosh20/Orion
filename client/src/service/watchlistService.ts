import { ENDPOINTS } from "../constants/endpoints";
import { api } from "../libs/api/client";

export interface WatchlistItem {
  id?: number;
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
    const response: any = await api.get(ENDPOINTS.WATCHLIST.GET(userId));
    
    // Extract data handling both raw Axios response and intercepted data
    const payload = response?.data ?? response;
    
    // Safely pull the array out of { watchlist: [...] }, { data: [...] }, or raw array
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.watchlist)) return payload.watchlist;
    if (Array.isArray(payload?.data)) return payload.data;
    
    return [];
  },

  /**
   * Add a symbol to the current active session's watchlist
   */
  addToWatchlist: async (userId: string, symbol: string): Promise<WatchlistItem> => {
    const response: any = await api.post(ENDPOINTS.WATCHLIST.ADD, { userId, symbol });
    const payload = response?.data ?? response;
    return payload?.data ?? payload;
  },

  /**
   * Remove a symbol from the watchlist
   */
  removeFromWatchlist: async (userId: string, symbol: string): Promise<void> => {
    await api.delete(ENDPOINTS.WATCHLIST.REMOVE(userId, symbol));
  },
};