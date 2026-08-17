import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { ENV } from "../../config/env.js";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: ENV.GEMINI_API_KEY });

if (!ENV.GEMINI_API_KEY) {
  console.error("[AI Service] GEMINI_API_KEY is not set — every insight request will fail.");
}

const GEMINI_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms — check network egress to generativelanguage.googleapis.com and GEMINI_API_KEY validity`)), ms),
    ),
  ]);
}

// ==========================================
// SCHEMA — now carries confluence + invalidation reasoning
// so "no trade" is a first-class, equally-weighted output
// instead of something we only discover after the fact.
// ==========================================

const insightSchema = {
  type: Type.OBJECT,
  properties: {
    marketStatus: { type: Type.STRING },
    analysis: { type: Type.STRING },
    conditionalSetup: { type: Type.STRING },
    keyLevel: { type: Type.NUMBER },
    confidence: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"] },

    // NEW — forces the model to show its work on why a trade
    // does or doesn't qualify, rather than silently filling the
    // schema either way.
    confluenceScore: { type: Type.NUMBER }, // 0-6, see CONFLUENCE_FACTORS below
    confluenceFactorsMet: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    htfAlignment: { type: Type.BOOLEAN }, // does higher-timeframe bias agree?
    liquiditySwept: { type: Type.BOOLEAN }, // did price take out equal highs/lows before this setup?
    volatilityRegime: { type: Type.STRING, enum: ["SQUEEZE", "EXPANDING", "NORMAL"] },
    invalidationReason: {
      type: Type.STRING,
      nullable: true,
      description: "If tradePosition is null, the single biggest reason no setup qualifies.",
    },

    tradePosition: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        side: { type: Type.STRING, enum: ["LONG", "SHORT"] },
        entry: { type: Type.NUMBER },
        stopLoss: { type: Type.NUMBER },
        target: { type: Type.NUMBER },
        stopBasis: {
          type: Type.STRING,
          description: "Why the stop sits here structurally — e.g. 'below swept swing low' — not just a % distance.",
        },
      },
      required: ["side", "entry", "stopLoss", "target", "stopBasis"],
    },
  },
  required: [
    "marketStatus", "analysis", "conditionalSetup", "keyLevel", "confidence",
    "confluenceScore", "confluenceFactorsMet", "htfAlignment", "liquiditySwept",
    "volatilityRegime", "invalidationReason", "tradePosition",
  ],
};

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

// NEW — minimal higher-timeframe snapshot. Cheap to compute (you already
// pull klines per interval) — just fetch one HTF candle set alongside
// the active one and derive bias the same way you derive it for price/SMA.
export interface HigherTimeframeContext {
  interval: string; // e.g. "4h" when active interval is "15m"
  price: number;
  sma: number | null;
  biasLabel: "BULLISH" | "BEARISH" | "NEUTRAL";
}

// NEW — equal highs/lows + sweep detection. Compute this in your
// structure-detection layer the same way you compute BOS/FVG today.
export interface LiquidityContext {
  equalHighs: number | null;
  equalLows: number | null;
  recentSweepHigh: boolean; // price wicked above equalHighs then closed back below
  recentSweepLow: boolean;  // price wicked below equalLows then closed back above
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
  structure?: {
    bullishBOS: boolean;
    bearishBOS: boolean;
    fvgAbove: number | null;
    fvgBelow: number | null;
    orderBlockAbove: number | null;
    orderBlockBelow: number | null;
  };
  // NEW inputs
  higherTimeframe?: HigherTimeframeContext | null;
  liquidity?: LiquidityContext | null;
  sessionLabel?: "ASIA" | "LONDON" | "NY_AM" | "NY_PM" | "OFF_SESSION";
}

export interface MarketInsight {
  marketStatus: string;
  analysis: string;
  conditionalSetup: string;
  keyLevel: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  confluenceScore: number;
  confluenceFactorsMet: string[];
  htfAlignment: boolean;
  liquiditySwept: boolean;
  volatilityRegime: "SQUEEZE" | "EXPANDING" | "NORMAL";
  invalidationReason: string | null;
  tradePosition: {
    side: "LONG" | "SHORT";
    entry: number;
    stopLoss: number;
    target: number;
    stopBasis: string;
  } | null;
}

interface TimeframeProfile {
  style: "scalp" | "intraday" | "swing" | "position";
  description: string;
  entryTolerancePct: number;
}

function getTimeframeProfile(interval: string): TimeframeProfile {
  switch (interval) {
    case "1m":
    case "5m":
      return { style: "scalp", entryTolerancePct: 0.3, description: "Scalping timeframe. Valid for 5-15 minute holding period." };
    case "15m":
    case "30m":
    case "1h":
      return { style: "intraday", entryTolerancePct: 0.75, description: "Intraday timeframe. Valid for 1-4 hour holding period." };
    case "2h":
    case "4h":
      return { style: "swing", entryTolerancePct: 1.5, description: "Swing timeframe. Valid for 1-3 day holding period." };
    case "1d":
    case "1w":
    case "1M":
      return { style: "position", entryTolerancePct: 3.0, description: "Position timeframe. Valid for multi-day to multi-week holding period." };
    default:
      return { style: "intraday", entryTolerancePct: 1.0, description: "Standard intraday evaluation." };
  }
}

// Volatility regime from Bollinger Band width relative to price —
// cheap heuristic, no extra data collection needed since you already
// have bollingerBands wired into MarketDataInput (just wasn't used before).
function classifyVolatility(bb: BollingerBands | null | undefined, price: number): "SQUEEZE" | "EXPANDING" | "NORMAL" {
  if (!bb || !price) return "NORMAL";
  const widthPct = ((bb.upper - bb.lower) / bb.middle) * 100;
  if (widthPct < 2) return "SQUEEZE";
  if (widthPct > 6) return "EXPANDING";
  return "NORMAL";
}

function validateTradePosition(
  trade: MarketInsight["tradePosition"],
  latestPrice: number,
  riskPercent: number,
  entryTolerancePct: number,
  minConfluenceScore: number,
  actualConfluenceScore: number,
): MarketInsight["tradePosition"] {
  if (!trade) return null;
  if (actualConfluenceScore < minConfluenceScore) return null;

  const { side, entry, stopLoss, target } = trade;
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(target)) return null;

  const entryDeviationPct = Math.abs((entry - latestPrice) / latestPrice) * 100;
  if (entryDeviationPct > entryTolerancePct) return null;

  if (side === "LONG" && !(stopLoss < entry && target > entry)) return null;
  if (side === "SHORT" && !(stopLoss > entry && target < entry)) return null;

  const stopDistancePct = (Math.abs(entry - stopLoss) / entry) * 100;
  if (stopDistancePct > riskPercent * 1.5) return null;

  return trade;
}

// Minimum confluence factors required before a trade is allowed through.
// Tune this per your risk appetite — 4/6 is a reasonably strict default.
const MIN_CONFLUENCE_SCORE = 4;

export class AiInsightService {
  public static async generateMarketInsight(marketData: MarketDataInput): Promise<MarketInsight> {
    const {
      symbol, interval, latestPrice, rsi, sma, newsHeadlines,
      atr, adx,
      volume24hChangePct, fundingRate,
      bollingerBands, vwap,
      riskPercent = 1.0, riskRewardRatio = 2.0,
      structure, higherTimeframe, liquidity, sessionLabel,
    } = marketData;

    const profile = getTimeframeProfile(interval);
    const volatilityRegime = classifyVolatility(bollingerBands, latestPrice);

    try {
      const newsContext = newsHeadlines && newsHeadlines.length > 0
        ? newsHeadlines.map((h, i) => `${i + 1}. "${h}"`).join("\n")
        : "No major headlines found for this session.";

      const structureContext = structure
        ? `=== MARKET STRUCTURE ===
        Break of Structure (BOS): ${structure.bullishBOS ? "Bullish" : structure.bearishBOS ? "Bearish" : "None"}
        Fair Value Gap Above: ${structure.fvgAbove ?? "None"}
        Fair Value Gap Below: ${structure.fvgBelow ?? "None"}
        Order Block Above: ${structure.orderBlockAbove ?? "None"}
        Order Block Below: ${structure.orderBlockBelow ?? "None"}`
        : "No structural update detected.";

      const liquidityContext = liquidity
        ? `=== LIQUIDITY ===
        Equal Highs: ${liquidity.equalHighs ?? "None"}
        Equal Lows: ${liquidity.equalLows ?? "None"}
        Recent sweep of highs (stop hunt up, then reject): ${liquidity.recentSweepHigh}
        Recent sweep of lows (stop hunt down, then reject): ${liquidity.recentSweepLow}`
        : "No liquidity pool data available — treat as unknown, do not assume a sweep occurred.";

      const htfContext = higherTimeframe
        ? `=== HIGHER TIMEFRAME (${higherTimeframe.interval}) ===
        HTF Price: ${higherTimeframe.price}
        HTF SMA: ${higherTimeframe.sma ?? "N/A"}
        HTF Bias: ${higherTimeframe.biasLabel}`
        : "No higher-timeframe context supplied — do not claim HTF alignment.";

      const sessionContext = sessionLabel
        ? `Current session: ${sessionLabel}. London Open and NY AM kill zones carry higher setup reliability than off-session hours.`
        : "Session unknown.";

      const volumeFundingContext = `
        24h Volume Change: ${volume24hChangePct != null ? volume24hChangePct.toFixed(2) + "%" : "N/A"}
        Funding Rate: ${fundingRate != null ? fundingRate.toFixed(4) + "%" : "N/A"} (extreme positive/negative funding suggests crowded positioning — a contrarian squeeze risk, not a reason to chase)
        VWAP: ${vwap ?? "N/A"}
      `;

      const prompt = `
You are Orion, a quantitative crypto market strategist focused on capital preservation. You are deliberately conservative: returning no trade is a success, not a failure, when confluence is weak.

--- TIMEFRAME CONTEXT (${interval}, ${profile.style} style) ---
${profile.description}

${structureContext}

${liquidityContext}

${htfContext}

${sessionContext}

--- VOLATILITY REGIME ---
Classified as: ${volatilityRegime}. SQUEEZE regimes have a high false-breakout rate — require stronger confluence before trading them. EXPANDING regimes favor momentum continuation over mean reversion.

--- CONFLUENCE FACTORS (score 0-6, one point each) ---
1. Trend/momentum bias agrees (Price vs SMA, RSI > 50 for longs / < 50 for shorts)
2. ADX > 25 (real trend, not chop)
3. Structure confirms direction (BOS in the same direction, or price reacting from FVG/Order Block)
4. Liquidity was swept in the opposite direction before this setup (stop hunt before the real move)
5. Higher-timeframe bias agrees with the setup direction
6. Volume/funding support the move (rising volume on breakout; funding not already extremely crowded in this direction)

A trade should only be proposed when confluenceScore >= ${MIN_CONFLUENCE_SCORE}. List which factors were met in confluenceFactorsMet. If fewer than ${MIN_CONFLUENCE_SCORE} are met, set tradePosition to null and explain the single biggest missing factor in invalidationReason.

--- RISK & STOP LOGIC ---
- Entry: Must be within ${profile.entryTolerancePct}% of current price (${latestPrice}).
- Stop-Loss: Must sit at a structural invalidation point (beyond the swept swing high/low, or beyond the order block) — NOT an arbitrary percentage. Describe this in stopBasis. Stop distance must not exceed ${riskPercent}% from entry.
- Target: Stop-loss distance x ${riskRewardRatio}, adjusted to the nearest meaningful liquidity pool or FVG if one falls close by.

Telemetry:
- Asset: ${symbol} (${interval})
- Price: ${latestPrice}
- RSI: ${rsi !== null ? rsi.toFixed(2) : "N/A"}
- SMA: ${sma !== null ? sma.toFixed(2) : "N/A"}
- ATR: ${atr ?? "N/A"}
- ADX: ${adx != null ? adx.toFixed(2) : "N/A"}
${volumeFundingContext}

Macro context:
${newsContext}
`;

      console.log(`[AI Service] Sending request to Gemini for ${symbol}...`);
      const response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: prompt,
          config: { responseMimeType: "application/json", responseSchema: insightSchema },
        }),
        GEMINI_TIMEOUT_MS,
        `Gemini generateContent (${symbol})`,
      );

      const raw = response.text;
      if (!raw) throw new Error("No insight text generated by Orion AI.");

      const parsedInsight = JSON.parse(raw) as MarketInsight;
      const validatedTrade = validateTradePosition(
        parsedInsight.tradePosition,
        latestPrice,
        riskPercent,
        profile.entryTolerancePct,
        MIN_CONFLUENCE_SCORE,
        parsedInsight.confluenceScore ?? 0,
      );

      return {
        ...parsedInsight,
        volatilityRegime, // trust our own calculation over the model's, since it's deterministic
        tradePosition: validatedTrade,
        confidence: validatedTrade ? parsedInsight.confidence : "LOW",
      };
    } catch (error: any) {
      console.error(`[AI Insight Error] for ${symbol}:`, error?.message || error);
      throw new Error("Failed to generate AI market synthesis.");
    }
  }
}