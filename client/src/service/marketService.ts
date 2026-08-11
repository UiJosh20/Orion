import { ENDPOINTS } from "../constants/endpoints";
import { api } from "../libs/api/client";


export interface SupportedSymbol {
  id: number;
  symbol: string;
  name: string;
  category: 'crypto' | 'forex';
  exchange: string;
}

export const marketService = {
  getSupportedSymbols: async (): Promise<SupportedSymbol[]> => {
    const response = await api.get(ENDPOINTS.MARKET.SYMBOLS);
    return response.data;
  },

  getMarketAnalysis: async (symbol: string) => {
    const response = await api.get(ENDPOINTS.MARKET.ANALYZE, {
      params: { symbol },
    });
    return response.data;
  },
};