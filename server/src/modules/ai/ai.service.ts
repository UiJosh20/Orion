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
  }) {
    try {
      //   const prompt = `
      //     You are Orion, a friendly and clear financial guide for everyday people.
      //     Analyze this market data and provide a simple report in **plain, everyday English**.

      //     CRITICAL RULE: Do NOT use heavy financial jargon or acronyms like "RSI" or "SMA" without explaining them instantly in simple terms.
      //     - Translate the 20-period moving average into: "the recent average price".
      //     - Translate the RSI into: "momentum (how fast prices have been rising or falling)".

      //     - Asset: ${marketData.symbol}
      //     - Timeframe: ${marketData.interval}
      //     - Current Price: ${marketData.latestPrice}
      //     - Momentum / RSI: ${marketData.rsi !== null ? marketData.rsi.toFixed(2) : "N/A"}
      //     - Recent Average Price (SMA): ${marketData.sma !== null ? marketData.sma.toFixed(2) : "N/A"}

      //     Provide your response in this exact simple format:
      //     1. **Market Summary:** (1 clear sentence on what the market is doing right now using everyday terms)
      //     2. **For Day Traders:** (1 short, practical idea for short-term traders)
      //     3. **For Swing Traders:** (1 short, practical idea for multi-day traders)
      //     4. **Key Level to Watch:** (One vital price point explained simply)
      //   `;
      const prompt = `
        You are Orion, an elite and direct trading assistant built in the style of JARVIS. You provide clear, objective market analysis without being overly restrictive.
        Analyze this market data and provide a concise report in **plain, everyday English**. 

        CRITICAL RULES:
        1. Do NOT use heavy financial jargon without instant plain English translation:
           - SMA (20) = "recent average price"
           - RSI = "momentum (how fast prices have been rising or falling)"
        2. Instead of blocking trades, explain the current state, what to expect next, and outline precise conditional entry setups if the market moves in a favorable direction.

        - Asset: ${marketData.symbol}
        - Timeframe: ${marketData.interval}
        - Current Price: ${marketData.latestPrice}
        - Momentum / RSI: ${marketData.rsi !== null ? marketData.rsi.toFixed(2) : "N/A"}
        - Recent Average Price (SMA): ${marketData.sma !== null ? marketData.sma.toFixed(2) : "N/A"}

        Provide your response in this exact format:
        1. **Market Status:** (1 clear sentence on current market state)
        2. **Analysis & Expectation:** (What the price and indicators are signaling and what to expect next)
        3. **Conditional Setup & Entry:** (If market moves our way, exact zone to look for entry and safety stop)
        4. **Key Level to Watch:** (One vital price point)
      `;

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
