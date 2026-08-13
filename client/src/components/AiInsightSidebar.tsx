"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Activity, TrendingUp, X, Sliders, ShieldOff } from "lucide-react";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { aiService } from "../service/aiservice";
import { alertService } from "../service/alertService";

const THINKING_STEPS = [
  "Initializing high-precision telemetry...",
  "Running strict risk-reward filter models...",
  "Analyzing order book liquidity & market structure...",
  "Verifying multi-timeframe indicator confluence...",
  "Synthesizing zero-loss probability setup...",
];

type Confidence = "LOW" | "MEDIUM" | "HIGH";

interface AiTradePosition {
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  target: number;
}

interface AiInsightPayload {
  marketStatus?: string;
  analysis?: string;
  conditionalSetup?: string;
  keyLevel?: number;
  confidence?: Confidence;
  tradePosition: AiTradePosition | null;
}

// Helper to remove markdown bolding (**)
const cleanText = (text: string) => {
  if (!text) return "";
  return text.replace(/\*\*(.*?)\*\*/g, "$1");
};

// Helper to format prices
const formatPrice = (val: any) => {
  const num = Number(val);
  if (isNaN(num)) return val;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

// Parses the backend's structured JSON response into a typed payload.
// Returns null if the response can't be parsed — callers must treat that
// the same as "no setup", not fall back to a synthesized trade.
function parseInsightPayload(aiInsight: any): AiInsightPayload | null {
  if (!aiInsight) return null;

  let parsed = aiInsight;
  if (typeof aiInsight === "string") {
    try {
      const cleanedJson = aiInsight
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      parsed = JSON.parse(cleanedJson);
    } catch (e) {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  return {
    marketStatus: parsed.marketStatus,
    analysis: parsed.analysis,
    conditionalSetup: parsed.conditionalSetup,
    keyLevel: parsed.keyLevel,
    confidence: parsed.confidence,
    tradePosition: parsed.tradePosition ?? null,
  };
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  HIGH: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  MEDIUM: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  LOW: "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

export default function AiInsightsSidebar() {
  const {
    activeSymbol,
    activeInterval,
    openAlertModal,
    riskPercent,
    riskRewardRatio,
    setRiskConfig,
    accountBalance,
    setAccountBalance,
  }: any = useMarketStore();

  const userId = useAuthStore((state) => state.user?.id);

  const [insight, setInsight] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Modal State Management for Alert Flow
  const [modalStep, setModalStep] = useState<
    "closed" | "choose_ai_or_custom" | "confirm_ai_target" | "success"
  >("closed");
  const [isSubmittingAlert, setIsSubmittingAlert] = useState(false);
  const [alertSuccessMsg, setAlertSuccessMsg] = useState("");

  // Progressive loading timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setCurrentStepIndex(0);
      interval = setInterval(() => {
        setCurrentStepIndex((prev) =>
          prev < THINKING_STEPS.length - 1 ? prev + 1 : prev,
        );
      }, 1400);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Fetch insight. riskPercent/riskRewardRatio are passed through to the
  // backend so any tradePosition it returns already reflects the user's
  // chosen risk config — the frontend must not recompute its own numbers.
  const fetchInsight = useCallback(async () => {
    if (!activeSymbol) return;

    setIsLoading(true);
    setError("");
    setInsight(null);
    setModalStep("closed");

    try {
      const response = await aiService.getInsight(
        activeSymbol,
        activeInterval,
        { riskPercent, riskRewardRatio },
      );
      setInsight(response);
    } catch (err: any) {
      console.error("Failed to fetch AI insight:", err);
      setError(
        err?.response?.data?.error ||
          err.message ||
          "Failed to generate market insights.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeSymbol, activeInterval, riskPercent, riskRewardRatio]);

  useEffect(() => {
    fetchInsight();
  }, [fetchInsight]);

  const payload = insight?.aiInsight ? parseInsightPayload(insight.aiInsight) : null;

  const sections = payload
    ? [
        payload.marketStatus && { title: "Market Status & Bias", body: cleanText(payload.marketStatus) },
        payload.analysis && { title: "Strict Technical Confluence", body: cleanText(payload.analysis) },
        payload.conditionalSetup && { title: "Setup Requirement", body: cleanText(payload.conditionalSetup) },
      ].filter(Boolean) as { title: string; body: string }[]
    : [];

  const confidence = payload?.confidence;
  const tradePosition = payload?.tradePosition ?? null;

  // The trade panel (stop-loss, target, position sizing, alert) only renders
  // when the AI actually returned a setup AND didn't flag it as low
  // conviction. This is the fix: previously the UI always synthesized a
  // stop/target from a hardcoded fallback price regardless of what — or
  // whether — the AI recommended anything.
  const hasActionableTrade = !!tradePosition && confidence !== "LOW";

  const riskAmountUSD = tradePosition
    ? accountBalance * (riskPercent / 100)
    : 0;
  const stopDistance = tradePosition
    ? Math.abs(tradePosition.entry - tradePosition.stopLoss)
    : 0;
  const positionSize = stopDistance > 0 ? riskAmountUSD / stopDistance : 0;

  const handleConfirmAiAlertCreation = async () => {
    if (!tradePosition) return;

    if (!userId) {
      setModalStep("closed");
      openAlertModal({
        symbol: activeSymbol,
        suggestedPrice: tradePosition.target,
        condition: "ABOVE",
        rationale: cleanText("Orion AI risk-managed target configuration."),
      });
      return;
    }

    setIsSubmittingAlert(true);
    try {
      await alertService.createAlert({
        userId,
        symbol: activeSymbol,
        condition: "ABOVE",
        thresholdValue: tradePosition.target,
      });
      setAlertSuccessMsg(
        `Alert successfully created for ${activeSymbol} at $${formatPrice(tradePosition.target)}!`,
      );
      setModalStep("success");
      setTimeout(() => {
        setModalStep("closed");
      }, 3000);
    } catch (err: any) {
      console.error("Failed to create alert via endpoint:", err);
      setModalStep("closed");
      openAlertModal({
        symbol: activeSymbol,
        suggestedPrice: tradePosition.target,
        condition: "ABOVE",
        rationale: cleanText("Orion AI risk-managed target configuration."),
      });
    } finally {
      setIsSubmittingAlert(false);
    }
  };

  const handleChooseNoCustom = () => {
    setModalStep("closed");
    openAlertModal({
      symbol: activeSymbol,
      suggestedPrice: undefined,
      condition: "ABOVE",
      rationale: cleanText("Custom user alert target level."),
    });
  };

  return (
    <aside className="w-full lg:w-96 h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col p-5 font-mono text-xs overflow-y-auto transition-colors relative">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 mb-4 shrink-0">
        <div className="text-slate-900 dark:text-slate-100 font-bold tracking-wide">
          Orion Intelligence (Risk Guard)
        </div>
        <div className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-md">
          {activeSymbol} ({activeInterval})
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col space-y-4">
        {isLoading ? (
          <div className="p-6 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3 mt-2">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="text-blue-600 dark:text-blue-400 font-bold">
                Selectivity Scan
              </span>
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
            </div>
            <p className="text-slate-800 dark:text-slate-200 text-sm font-medium transition-all duration-300">
              {THINKING_STEPS[currentStepIndex]}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Filtering false breakouts and checking discount/premium structure...
            </p>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 space-y-2 mt-2">
            <div className="font-bold">Synthesis Interrupted</div>
            <p className="text-[11px] text-red-500 dark:text-red-300/80 leading-relaxed">
              {cleanText(error)}
            </p>
          </div>
        ) : payload ? (
          <div className="space-y-4 pb-6">
            {/* Technical Indicators Summary Bar */}
            {insight.indicators && (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 text-[11px]">
                    <Activity className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />{" "}
                    RSI
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-200 font-mono text-sm">
                    {insight.indicators.rsi}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 text-[11px]">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />{" "}
                    SMA
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-200 font-mono text-sm">
                    {formatPrice(insight.indicators.sma)}
                  </span>
                </div>
              </div>
            )}

            {/* Confidence badge — always shown so the user sees the AI's
                actual conviction, even (especially) when there's no trade */}
            {confidence && (
              <div
                className={`px-3 py-2 rounded-xl border text-[11px] font-bold flex items-center justify-between ${CONFIDENCE_STYLES[confidence]}`}
              >
                <span>Confidence</span>
                <span>{confidence}</span>
              </div>
            )}

            {hasActionableTrade && tradePosition ? (
              <>
                {/* Risk Management Configuration Panel — numbers come from
                    the AI's own tradePosition, not a locally-synthesized
                    fallback */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between text-slate-900 dark:text-slate-100 font-bold">
                    <span className="flex items-center gap-1.5 text-xs">
                      <Sliders className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />{" "}
                      {tradePosition.side} setup
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 dark:text-slate-400">
                        Risk % (Stop Loss)
                      </label>
                      <select
                        value={riskPercent}
                        onChange={(e) =>
                          setRiskConfig(Number(e.target.value), riskRewardRatio)
                        }
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-1.5 text-slate-800 dark:text-slate-200 font-mono text-xs"
                      >
                        <option value={0.5}>0.5% Risk</option>
                        <option value={1.0}>1.0% Risk</option>
                        <option value={1.5}>1.5% Risk</option>
                        <option value={2.0}>2.0% Risk</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 dark:text-slate-400">
                        Take Profit Ratio (R:R)
                      </label>
                      <select
                        value={riskRewardRatio}
                        onChange={(e) =>
                          setRiskConfig(riskPercent, Number(e.target.value))
                        }
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-1.5 text-slate-800 dark:text-slate-200 font-mono text-xs"
                      >
                        <option value={1.5}>1 : 1.5 (Standard)</option>
                        <option value={2.0}>1 : 2.0 (Optimal)</option>
                        <option value={2.5}>1 : 2.5 (Extended)</option>
                        <option value={3.0}>1 : 3.0 (High Target)</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Changing these refetches the AI's setup at the new risk config.
                  </p>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px]">
                    <div>
                      <span className="text-slate-500">Entry:</span>{" "}
                      <strong className="text-slate-900 dark:text-slate-100">
                        ${formatPrice(tradePosition.entry)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Stop:</span>{" "}
                      <strong className="text-rose-500">
                        ${formatPrice(tradePosition.stopLoss)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Target:</span>{" "}
                      <strong className="text-emerald-500">
                        ${formatPrice(tradePosition.target)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Account Balance & Position Sizing */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                  <div className="text-slate-900 dark:text-slate-100 font-bold text-xs">
                    Account & Position Size
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 dark:text-slate-400">
                      Account Balance (USD)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={accountBalance || ""}
                      onChange={(e) => setAccountBalance(Number(e.target.value))}
                      placeholder="e.g. 5000"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-1.5 text-slate-800 dark:text-slate-200 font-mono text-xs"
                    />
                  </div>
                  {accountBalance > 0 ? (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px]">
                      <div>
                        <span className="text-slate-500">Risking:</span>{" "}
                        <strong className="text-rose-500">
                          ${formatPrice(riskAmountUSD)}
                        </strong>
                        <span className="text-slate-400"> ({riskPercent}%)</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Position size:</span>{" "}
                        <strong className="text-emerald-500">
                          {positionSize.toFixed(4)} units
                        </strong>
                      </div>
                      {riskPercent > 2 && (
                        <div className="col-span-2 text-[10px] text-amber-500 pt-1">
                          Risking more than 2% per trade compounds drawdown fast —
                          most professional traders cap this at 1–2%.
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-400">
                      Enter your balance to see position size and dollar risk.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl flex items-start gap-2.5">
                <ShieldOff className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-slate-700 dark:text-slate-300 font-bold text-xs">
                    No high-conviction setup right now
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    {confidence === "LOW" && tradePosition
                      ? "The AI found a directional bias but flagged it low-confidence, so no trade is shown."
                      : "Market structure doesn't meet the discount/premium or risk criteria for a trade."}
                  </p>
                </div>
              </div>
            )}

            {/* Well-Spaced Report Sections */}
            <div className="space-y-3">
              {sections.map((sec, idx) => (
                <div
                  key={idx}
                  className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 rounded-xl space-y-1.5"
                >
                  <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                    {idx + 1}. {sec.title}
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                    {sec.body}
                  </p>
                </div>
              ))}
            </div>

            {/* Target Alert Action Button — only when there's a real trade */}
            {hasActionableTrade && tradePosition && (
              <div className="pt-2">
                <button
                  onClick={() => setModalStep("choose_ai_or_custom")}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center shadow-lg shadow-blue-500/20 text-xs"
                >
                  <span>
                    Set Alert on Target (${formatPrice(tradePosition.target)})
                  </span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400 space-y-2">
            <p>
              Initializing telemetry for{" "}
              <strong className="text-slate-900 dark:text-slate-300">
                {activeSymbol}
              </strong>
              ...
            </p>
          </div>
        )}
      </div>

      {/* Alert Flow Modal Overlay */}
      {modalStep !== "closed" && tradePosition && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                {modalStep === "success"
                  ? "Alert Confirmed"
                  : "Price Alert Configuration"}
              </span>
              <button
                onClick={() => setModalStep("closed")}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalStep === "choose_ai_or_custom" && (
              <div className="space-y-4">
                <p className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                  Would you like to set your alert at Orion&apos;s target of{" "}
                  <strong className="text-blue-600 dark:text-blue-400">
                    ${formatPrice(tradePosition.target)}
                  </strong>{" "}
                  (based on {riskPercent}% risk & {riskRewardRatio}x R:R ratio)?
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={() => setModalStep("confirm_ai_target")}
                    className="py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors text-center text-xs"
                  >
                    Yes
                  </button>
                  <button
                    onClick={handleChooseNoCustom}
                    className="py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition-colors text-center text-xs"
                  >
                    No, Custom
                  </button>
                </div>
              </div>
            )}

            {modalStep === "confirm_ai_target" && (
              <div className="space-y-4">
                <p className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                  Are you sure you want to set the alert for{" "}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {activeSymbol}
                  </strong>{" "}
                  at target price{" "}
                  <strong className="text-blue-600 dark:text-blue-400">
                    ${formatPrice(tradePosition.target)}
                  </strong>
                  ?
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={handleConfirmAiAlertCreation}
                    disabled={isSubmittingAlert}
                    className="py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-center text-xs flex items-center justify-center"
                  >
                    {isSubmittingAlert ? "Setting..." : "Yes, Create"}
                  </button>
                  <button
                    onClick={() => setModalStep("choose_ai_or_custom")}
                    disabled={isSubmittingAlert}
                    className="py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition-colors text-center text-xs"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            {modalStep === "success" && (
              <div className="space-y-3 py-2 text-center">
                <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-base">
                  ✓
                </div>
                <p className="text-slate-800 dark:text-slate-200 text-xs font-medium leading-relaxed">
                  {alertSuccessMsg}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}