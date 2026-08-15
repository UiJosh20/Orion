import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { ENV } from "../../config/env.js";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: ENV.GEMINI_API_KEY });

if (!ENV.GEMINI_API_KEY) {
  console.error("[AI Service] GEMINI_API_KEY is not set — every insight request will fail.");
}

const GEMINI_TIMEOUT_MS = 20_000;

/**
 * The Gemini SDK has no built-in timeout — if the network can't reach
 * generativelanguage.googleapis.com, the call hangs forever instead of
 * rejecting. This forces a hard failure so the socket layer can emit
 * insight_error instead of leaving the frontend stuck in "loading" state
 * indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms — check network egress to generativelanguage.googleapis.com and GEMINI_API_KEY validity`)), ms),
    ),
  ]);
}

const insightSchema = {
  type: Type.OBJECT,
  properties: {
    marketStatus: { type: Type.STRING },
    analysis: { type: Type.STRING },
    conditionalSetup: { type: Type.STRING },
    keyLevel: { type: Type.NUMBER },
    confidence: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"] },
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
  required: ["marketStatus", "analysis", "conditionalSetup", "keyLevel", "confidence", "tradePosition"],
};

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

export interface MarketDataInput {
  symbol: string;
  interval: string;
  assetType?: string;
  latestPrice: number;
  rsi: number | null;
  sma: number | null;
  newsHeadlines: string[];
  atr?: number | null;
  recentSwingHigh?: number | null;
  recentSwingLow?: number | null;
  volume24hChangePct?: number | null;
  fundingRate?: number | null;
  adx?: number | null;
  pdi?: number | null;
  mdi?: number | null;
  vwap?: number | null;
  bollingerBands?: BollingerBands | null;
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

function validateTradePosition(
  trade: MarketInsight["tradePosition"],
  latestPrice: number,
  riskPercent: number,
): MarketInsight["tradePosition"] {
  if (!trade) return null;
  const { side, entry, stopLoss, target } = trade;

  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(target)) return null;

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
  public static async generateMarketInsight(marketData: MarketDataInput): Promise<MarketInsight> {
    const {
      symbol, interval, latestPrice, rsi, sma, newsHeadlines,
      atr, recentSwingHigh, recentSwingLow, volume24hChangePct, fundingRate,
      adx, pdi, mdi, vwap, bollingerBands,
      riskPercent = 1.0, riskRewardRatio = 2.0,
    } = marketData;

    try {
      const newsContext = newsHeadlines && newsHeadlines.length > 0
        ? newsHeadlines.map((h, i) => `${i + 1}. "${h}"`).join("\n")
        : "No major breaking headlines found for this session.";

      const structureNote = recentSwingHigh != null && recentSwingLow != null
        ? `Local range: support ${recentSwingLow}, resistance ${recentSwingHigh}. "Discount" = lower third of this range, "Premium" = upper third.`
        : `No local support/resistance range was provided — treat structural conviction as capped at MEDIUM, since discount/premium cannot be confirmed against real levels.`;

      const trendStrengthNote = adx != null
        ? adx >= 25
          ? `ADX ${adx.toFixed(1)} confirms a genuine trend is in force (>25 threshold).`
          : `ADX ${adx.toFixed(1)} is below the 25 trending threshold — treat this as a weak or ranging market regardless of what RSI/SMA suggest, and cap confidence accordingly.`
        : `ADX not available — trend strength cannot be confirmed independently of RSI/SMA.`;

      const meanReversionNote = vwap != null || bollingerBands
        ? [
            vwap != null ? `VWAP: ${vwap.toFixed(4)} (a volume-weighted fair-value reference, distinct from SMA).` : null,
            bollingerBands
              ? `Bollinger Bands — upper: ${bollingerBands.upper.toFixed(4)}, middle: ${bollingerBands.middle.toFixed(4)}, lower: ${bollingerBands.lower.toFixed(4)}. Price near the lower band supports a discount LONG; price near the upper band supports a premium SHORT.`
              : null,
          ].filter(Boolean).join(" ")
        : `VWAP and Bollinger Bands not available — do not claim a mean-reversion or band-based rationale without this data.`;

      const prompt = `
You are Orion, a quantitative crypto market strategist focused on capital preservation.
Output a trade setup ONLY when momentum, structure, and risk parameters align cleanly. Otherwise, return null.
Never state a rationale (trend strength, mean-reversion, discount/premium) that isn't backed by the telemetry actually provided below.

--- EVALUATION ALGORITHM ---
STEP 1 — BIAS & MOMENTUM
- UPTREND (LONG): Price > SMA AND RSI > 50.
- DOWNTREND (SHORT): Price < SMA AND RSI < 50.
- NO TREND / CHOP: RSI between 45 and 55 with Price crossing SMA repeatedly → return null trade.
- Trend strength check: ${trendStrengthNote}

STEP 2 — LOCATION & STRUCTURE
- LONG SETUP: Look for price pulling back toward the SMA or test of lower swing bounds.
- SHORT SETUP: Look for price bouncing toward the SMA or test of upper swing bounds.
- If recent swing high/low data is missing ("N/A"), evaluate market structure strictly using Price vs SMA.
- ${structureNote}
- Mean-reversion context: ${meanReversionNote}

STEP 3 — RISK & CONVICTION
- Entry: Must be within 1% of current price (${latestPrice}).
- Stop-Loss: Maximum distance of ${riskPercent}% from entry${atr ? `, referencing ATR (${atr}) for placement` : ""}.
- Target: Stop-loss distance x ${riskRewardRatio}.
- Reduce confidence or return null if funding rate or 24h volume strongly opposes the trade direction.
- Reduce confidence or return null if ADX indicates a non-trending market.

STEP 4 — CONFIDENCE GRADUATION
- HIGH: Trend (confirmed by ADX), Structure, and Volume/Funding all agree.
- MEDIUM: Clear trend and valid risk-reward, but ADX, volume, or funding is neutral/unavailable.
- LOW / NULL: Conflicting indicators, chop, or ADX below trending threshold.

Telemetry:
- Asset: ${symbol} (${interval})
- Price: ${latestPrice}
- RSI: ${rsi !== null ? rsi.toFixed(2) : "N/A"}
- SMA: ${sma !== null ? sma.toFixed(2) : "N/A"}
- ATR: ${atr ?? "N/A"}
- ADX: ${adx != null ? adx.toFixed(2) : "N/A"} (+DI: ${pdi != null ? pdi.toFixed(2) : "N/A"}, -DI: ${mdi != null ? mdi.toFixed(2) : "N/A"})
- VWAP: ${vwap != null ? vwap.toFixed(4) : "N/A"}
- Bollinger Bands: ${bollingerBands ? `upper ${bollingerBands.upper.toFixed(4)} / mid ${bollingerBands.middle.toFixed(4)} / lower ${bollingerBands.lower.toFixed(4)}` : "N/A"}
- Recent swing high / low: ${recentSwingHigh ?? "N/A"} / ${recentSwingLow ?? "N/A"}
- 24h volume change: ${volume24hChangePct != null ? volume24hChangePct + "%" : "N/A"}
- Funding rate: ${fundingRate ?? "N/A"}

Macro context:
${newsContext}
`;

      console.log(`[AI Service] Sending request to Gemini for ${symbol}, prompt length: ${prompt.length} chars`);

      const response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: insightSchema,
          },
        }),
        GEMINI_TIMEOUT_MS,
        `Gemini generateContent (${symbol})`,
      );

      console.log(`[AI Service] Gemini response received for ${symbol}. Has text: ${!!response.text}`);

      const raw = response.text;
      if (!raw) {
        console.error(`[AI Service] Gemini returned no text for ${symbol}. Full response:`, JSON.stringify(response, null, 2));
        throw new Error("No insight text generated by Orion AI.");
      }

      const parsedInsight = JSON.parse(raw) as MarketInsight;

      const validatedTrade = validateTradePosition(parsedInsight.tradePosition, latestPrice, riskPercent);

      return {
        ...parsedInsight,
        tradePosition: validatedTrade,
        confidence: validatedTrade ? parsedInsight.confidence : "LOW",
      };
    } catch (error: any) {
      console.error(`[AI Insight Error] for ${symbol}:`, error?.message || error);

      if (error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED")) {
        throw new Error("AI daily rate limit reached. Please check your Gemini API quota or upgrade your plan.");
      }
      if (error?.message?.includes("timed out")) {
        throw new Error(error.message);
      }

      throw new Error("Failed to generate AI market synthesis.");
    }
  }
}