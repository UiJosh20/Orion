import axios from 'axios';
import { ENV } from '../../config/env.js';

export class NewsService {
  /**
   * Fetch recent headlines using Tiingo's News Endpoint (`https://api.tiingo.com/tiingo/news`)
   */
  public static async fetchNews(symbol: string): Promise<string[]> {
    const cleanSymbol = symbol.replace('/', '').toLowerCase();
    
    // Format ticker for Tiingo (e.g., BTCUSDT -> btc, EUR/USD -> eurusd)
    const tickerQuery = cleanSymbol.includes('usdt') 
      ? cleanSymbol.replace('usdt', '') 
      : cleanSymbol;

    try {
      const response = await axios.get('https://api.tiingo.com/tiingo/news', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${ENV.TIINGO_API_KEY}`,
        },
        params: {
          tickers: tickerQuery,
          limit: 3,
        },
        timeout: 4000,
      });

      if (Array.isArray(response.data)) {
        // Map based on Tiingo's schema where 'title' holds the article headline
        return response.data.map((item: any) => item.title);
      }
      return [];
    } catch (error: any) {
      console.warn(`[Tiingo News Warning]: Could not fetch headlines for ${symbol} (${error.message})`);
      return [];
    }
  }
}