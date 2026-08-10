import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { ENV } from "../../config/env.js";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: ENV.GEMINI_API_KEY });

export class AiInsightService {
  /**
   * Synthesize technical indicators and market telemetry into an AI-driven trade report
   */
  public static async generateMarketInsight(marketData: {
    symbol: string;
    interval: string;
    assetType: string;
    latestPrice: number;
    rsi: number | null;
    sma: number | null;
    newsHeadlines: string[];
  }) {
    try {

const { symbol, interval, assetType, latestPrice, rsi, sma, newsHeadlines } = marketData;

    const newsContext = newsHeadlines && newsHeadlines.length > 0 
      ? newsHeadlines.map((h, i) => `${i + 1}. "${h}"`).join('\n')
      : 'No major breaking headlines found for this session.';

    const prompt = `
      You are Orion, an elite quantitative and sentiment trading assistant. 
      Analyze the current market data and breaking news sentiment for ${symbol} (${assetType}) on the ${interval} timeframe.

      --- QUANTITATIVE METRICS ---
      - Current Price: ${latestPrice}
      - RSI (Momentum): ${rsi !== null ? rsi.toFixed(2) : 'N/A'}
      - SMA (Trend Average): ${sma !== null ? sma.toFixed(2) : 'N/A'}

      --- RECENT NEWS & SENTIMENT ---
      ${newsContext}

      Provide your analysis strictly structured into these 4 numbered sections:
      1. **Market Status:** (Summarize price action and prevailing trend considering both data and news sentiment).
      2. **Analysis & Expectation:** (Blend technical indicator readings with macro news catalysts to explain why the market is behaving this way).
      3. **Conditional Setup & Entry:** (Provide specific entry zones, strategy, and risk management/stop-loss levels).
      4. **Key Level to Watch:** (Highlight the most critical price boundary or support/resistance ceiling).
    `;
    //   const prompt = `
    //     You are Orion, an elite and direct trading assistant built in the style of JARVIS. You provide clear, objective market analysis without being overly restrictive.
    //     Analyze this market data and provide a concise report in **plain, everyday English**. 

    //     CRITICAL RULES:
    //     1. Do NOT use heavy financial jargon without instant plain English translation:
    //        - SMA (20) = "recent average price"
    //        - RSI = "momentum (how fast prices have been rising or falling)"
    //     2. Instead of blocking trades, explain the current state, what to expect next, and outline precise conditional entry setups if the market moves in a favorable direction.

    //     - Asset: ${marketData.symbol}
    //     - Timeframe: ${marketData.interval}
    //     - Current Price: ${marketData.latestPrice}
    //     - Momentum / RSI: ${marketData.rsi !== null ? marketData.rsi.toFixed(2) : "N/A"}
    //     - Recent Average Price (SMA): ${marketData.sma !== null ? marketData.sma.toFixed(2) : "N/A"}

    //     Provide your response in this exact format:
    //     1. **Market Status:** (1 clear sentence on current market state)
    //     2. **Analysis & Expectation:** (What the price and indicators are signaling and what to expect next)
    //     3. **Conditional Setup & Entry:** (If market moves our way, exact zone to look for entry and safety stop)
    //     4. **Key Level to Watch:** (One vital price point)
    //   `;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });

      return response.text;
    } catch (error: any) {
      console.error("[AI Insight Error]:", error);
      throw new Error("Failed to generate AI market synthesis.");
    }
  }
}
