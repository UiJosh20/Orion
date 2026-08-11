import { ENDPOINTS } from "../constants/endpoints";
import { api } from "../libs/api/client";


export interface AIInsightResponse {
  symbol: string;
  summary: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  updatedAt: string;
}

export const aiService = {
  getInsight: async (symbol: string, interval: string): Promise<AIInsightResponse> => {
    const response = await api.get(ENDPOINTS.AI.INSIGHT, {
      params: { symbol, interval },
    });
    return response.data;
  },
};