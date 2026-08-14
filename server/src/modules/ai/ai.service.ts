import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { ENV } from "../../config/env.js";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: ENV.GEMINI_API_KEY });

/**
 * Structured response schema — forces Gemini to return valid, parseable JSON
 * every time instead of relying on prompt-text formatting instructions.
 */
const insightSchema = {
  type: Type.OBJECT,
  properties: {
    marketStatus: { type: Type.STRING },
    analysis: { type: Type.STRING },
    conditionalSetup: { type: Type.STRING },
    keyLevel: { type: Type.NUMBER },
    confidence: {
      type: Type.STRING,
      enum: ["LOW", "MEDIUM", "HIGH"],
    },
    tradePosition: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        side: { type: Type.STRING, enum: ["LONG", "SHORT"] },
        entry: { type: Type.NUMBER },
        stopLoss: { type: Type.NUMBER },
        target: { type: Type.NUMBER },
      },
      required: ["side", "entry", "stopLoss", "target"],
    },
  },
  required: [
    "marketStatus",
    "analysis",
    "conditionalSetup",
    "keyLevel",
    "confidence",
    "tradePosition",
  ],
};

export interface MarketDataInput {
  symbol: string;
  interval: string;
  assetType?: string;
  latestPrice: number;
  rsi: number | null;
  sma: number | null;
  newsHeadlines: string[];

  // Structural context computed by YOUR backend, not the LLM.
  atr?: number | null;
  recentSwingHigh?: number | null;
  recentSwingLow?: number | null;
  volume24hChangePct?: number | null;
  fundingRate?: number | null;

  riskPercent?: number;
  riskRewardRatio?: number;
}

export interface MarketInsight {
  marketStatus: string;
  analysis: string;
  conditionalSetup: string;
  keyLevel: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  tradePosition: {
    side: "LONG" | "SHORT";
    entry: number;
    stopLoss: number;
    target: number;
  } | null;
}

/**
 * Deterministic sanity check on what the model returned. Prompt instructions
 * alone can't guarantee internal consistency — this is what actually
 * prevents a broken or hallucinated trade from reaching the UI.
 *
 * Rejects (returns null) when:
 * - entry is more than 5% away from the live price
 * - stop-loss / target are on the wrong side of entry for the given side
 * - stop distance exceeds the configured riskPercent by more than 50%
 */
function validateTradePosition(
  trade: MarketInsight["tradePosition"],
  latestPrice: number,
  riskPercent: number,
): MarketInsight["tradePosition"] {
  if (!trade) return null;

  const { side, entry, stopLoss, target } = trade;

  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(target)) {
    return null;
  }

  const entryDeviationPct = Math.abs((entry - latestPrice) / latestPrice) * 100;
  if (entryDeviationPct > 5) {
    console.warn(`[AI Validation] Rejected trade: entry ${entry} deviates ${entryDeviationPct.toFixed(2)}% from live price ${latestPrice}`);
    return null;
  }

  if (side === "LONG" && !(stopLoss < entry && target > entry)) {
    console.warn(`[AI Validation] Rejected LONG trade: inconsistent side/level ordering`);
    return null;
  }
  if (side === "SHORT" && !(stopLoss > entry && target < entry)) {
    console.warn(`[AI Validation] Rejected SHORT trade: inconsistent side/level ordering`);
    return null;
  }

  const stopDistancePct = (Math.abs(entry - stopLoss) / entry) * 100;
  if (stopDistancePct > riskPercent * 1.5) {
    console.warn(`[AI Validation] Rejected trade: stop distance ${stopDistancePct.toFixed(2)}% exceeds configured risk ${riskPercent}% by more than 50%`);
    return null;
  }

  return trade;
}

export class AiInsightService {
  public static async generateMarketInsight(
    marketData: MarketDataInput,
  ): Promise<MarketInsight> {
    try {
      const {
        symbol,
        interval,
        latestPrice,
        rsi,
        sma,
        newsHeadlines,
        atr,
        recentSwingHigh,
        recentSwingLow,
        volume24hChangePct,
        fundingRate,
        riskPercent = 1.0,
        riskRewardRatio = 2.0,
      } = marketData;

      const newsContext =
        newsHeadlines && newsHeadlines.length > 0
          ? newsHeadlines.map((h, i) => `${i + 1}. "${h}"`).join("\n")
          : "No major breaking headlines found for this session.";

      const structureNote =
        recentSwingHigh != null && recentSwingLow != null
          ? `Local range: support ${recentSwingLow}, resistance ${recentSwingHigh}. "Discount" = lower third of this range, "Premium" = upper third.`
          : `No local support/resistance range was provided — treat structural conviction as capped at MEDIUM, since discount/premium cannot be confirmed against real levels.`;

      const prompt = `
You are Orion, a quantitative crypto market strategist. Your objective is capital
preservation and selectivity — you would rather output nothing than a low-conviction
guess. You never invent price structure that wasn't given to you in the data below.
Your "entry" price must be within 1% of the current price (${latestPrice}) — you are
identifying a setup at or near current price, not forecasting a future price to enter at.

--- EVALUATION ALGORITHM ---
STEP 1 — BIAS
- UPTREND: price > SMA and RSI in 45-70 → only consider LONG, and only at a discount.
- DOWNTREND: price < SMA and RSI in 30-55 → only consider SHORT, and only at a premium.
- RANGING: RSI 40-60 with no clear structure → tradePosition MUST be null.

STEP 2 — DISCOUNT / PREMIUM (use the provided structure, not intuition)
${structureNote}
- Do not call a LONG setup "discount" if price is in the upper half of the given range.
- Do not call a SHORT setup "premium" if price is in the lower half of the given range.

STEP 3 — RISK
- Stop-loss distance must not exceed ${riskPercent}% of entry price${atr ? `, and should reference ATR (${atr}) for volatility-adjusted placement` : ""}.
- Target = stop-loss distance x ${riskRewardRatio}.
- If funding rate or volume data conflicts with the setup direction, lower confidence
  or null the trade rather than overriding the conflict.

STEP 4 — CONFIDENCE
- HIGH: bias, structure, and risk data all agree, with clean discount/premium entry.
- MEDIUM: directionally aligned but missing confirming structure or data.
- LOW / null trade: conflicting signals, ranging market, or insufficient structure.
Only output HIGH when every input genuinely agrees — do not inflate confidence.

Telemetry:
- Asset: ${symbol} (${interval})
- Price: ${latestPrice}
- RSI: ${rsi !== null ? rsi.toFixed(2) : "N/A"}
- SMA: ${sma !== null ? sma.toFixed(2) : "N/A"}
- ATR: ${atr ?? "N/A"}
- Recent swing high / low: ${recentSwingHigh ?? "N/A"} / ${recentSwingLow ?? "N/A"}
- 24h volume change: ${volume24hChangePct != null ? volume24hChangePct + "%" : "N/A"}
- Funding rate: ${fundingRate ?? "N/A"}

Macro news:
${newsContext}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: insightSchema,
        },
      });

      const raw = response.text;
      if (!raw) throw new Error("No insight text generated by Orion AI.");

      const parsedInsight = JSON.parse(raw) as MarketInsight;

      // Hard guardrail — never let an internally inconsistent or
      // off-market trade reach the frontend, regardless of what the
      // model's own "confidence" field claims.
      const validatedTrade = validateTradePosition(
        parsedInsight.tradePosition,
        latestPrice,
        riskPercent,
      );

      return {
        ...parsedInsight,
        tradePosition: validatedTrade,
        confidence: validatedTrade ? parsedInsight.confidence : "LOW",
      };
    } catch (error: any) {
      console.error("[AI Insight Error]:", error);

      if (
        error?.status === 429 ||
        error?.message?.includes("RESOURCE_EXHAUSTED")
      ) {
        throw new Error(
          "AI daily rate limit reached. Please check your Gemini API quota or upgrade your plan.",
        );
      }

      throw new Error("Failed to generate AI market synthesis.");
    }
  }
}