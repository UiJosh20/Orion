"use client";

import React, { useState, useEffect, useRef } from "react";
import { Activity, TrendingUp, X, Sliders, ShieldOff } from "lucide-react";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { useSocket } from "../providers/SocketProvider";
import { alertService } from "../service/alertService";
import { calculateProfitBreakdown } from "../libs/tradingMath";
import { api } from "@/src/libs/api/client";
import { ENDPOINTS } from "@/src/constants/endpoints";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type Confidence = "LOW" | "MEDIUM" | "HIGH";
interface AiTradePosition { side: "LONG" | "SHORT"; entry: number; stopLoss: number; target: number; }
interface InsightPayload { symbol: string; interval: string; latestPrice?: number; indicators?: { rsi: number | null; sma: number | null }; aiInsight: { marketStatus?: string; analysis?: string; conditionalSetup?: string; keyLevel?: number; confidence?: Confidence; tradePosition: AiTradePosition | null; }; }

const cleanText = (text: string) => { if (!text) return ""; return text.replace(/\*\*(.*?)\*\*/g, "$1"); };
const formatPrice = (val: any) => { const num = Number(val); if (isNaN(num)) return val; return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, }); };

const CONFIDENCE_STYLES: Record<Confidence, string> = { 
  HIGH: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", 
  MEDIUM: "bg-amber-500/10 text-amber-500 border-amber-500/30", 
  LOW: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30", 
};

const THINKING_STEPS = [
  "Initializing high-precision telemetry...",
  "Running strict risk-reward filter models...",
  "Analyzing order book liquidity & market structure...",
  "Verifying multi-timeframe indicator confluence...",
  "Checking discount/premium structure...",
];

export default function AiInsightsSidebar() {
  const { activeSymbol, activeInterval, openAlertModal, riskPercent, riskRewardRatio, setRiskConfig, accountBalance, setAccountBalance } = useMarketStore();
  const userId = useAuthStore((state) => state.user?.id); 
  const { socket, isConnected } = useSocket();
  
  const [insight, setInsight] = useState<InsightPayload | null>(null); 
  const [isLoading, setIsLoading] = useState(true); 
  const [error, setError] = useState(""); 
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [modalStep, setModalStep] = useState<"closed" | "choose_ai_or_custom" | "confirm_ai_target" | "success">("closed"); 
  const [isSubmittingAlert, setIsSubmittingAlert] = useState(false); 
  const [alertSuccessMsg, setAlertSuccessMsg] = useState("");
  const activeSubRef = useRef<{ symbol: string; interval: string; riskPercent: number; riskRewardRatio: number; } | null>(null);

  useEffect(() => { 
    let interval: NodeJS.Timeout; 
    if (isLoading) { 
      setCurrentStepIndex(0); 
      interval = setInterval(() => { setCurrentStepIndex((prev) => prev < THINKING_STEPS.length - 1 ? prev + 1 : prev); }, 1400); 
    } 
    return () => clearInterval(interval); 
  }, [isLoading]);

  const saveRiskConfigToBackend = async (risk: number, ratio: number) => { 
    if (!userId) return; 
    try { await api.post(ENDPOINTS.MARKET.RISK_CONFIG, { userId, riskPercent: risk, riskRewardRatio: ratio, }); } 
    catch (error) { console.error("Failed to save risk config:", error); } 
  };
  
  const handleRiskChange = (e: React.ChangeEvent<HTMLSelectElement>) => { const newRisk = Number(e.target.value); setRiskConfig(newRisk, riskRewardRatio); saveRiskConfigToBackend(newRisk, riskRewardRatio); };
  const handleRatioChange = (e: React.ChangeEvent<HTMLSelectElement>) => { const newRatio = Number(e.target.value); setRiskConfig(riskPercent, newRatio); saveRiskConfigToBackend(riskPercent, newRatio); };

  useEffect(() => {
    if (!socket || !isConnected || !activeSymbol) return;
    setIsLoading(true); setError(""); setInsight(null); setModalStep("closed");
    const params = { symbol: activeSymbol, interval: activeInterval, riskPercent, riskRewardRatio, };
    const cleanSymbol = (sym?: string) => sym?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? "";
    
    const handleInsightUpdate = (payload: InsightPayload) => {
      if (!payload) return;
      const payloadSym = cleanSymbol(payload.symbol); const currentSym = cleanSymbol(activeSymbol); const payloadInt = payload.interval?.toLowerCase(); const currentInt = activeInterval?.toLowerCase();
      if (payloadSym !== currentSym || payloadInt !== currentInt) return;
      setInsight(payload); setIsLoading(false); setError("");
    };
    
    const handleInsightError = (err: { symbol: string; message: string }) => { if (cleanSymbol(err.symbol) !== cleanSymbol(activeSymbol)) return; setError(err.message || "Failed to generate market insight."); setIsLoading(false); };
    
    socket.on("insight_update", handleInsightUpdate); socket.on("insight_error", handleInsightError);
    if (activeSubRef.current) socket.emit("unsubscribe_insight", activeSubRef.current);
    socket.emit("subscribe_insight", params); activeSubRef.current = params;
    return () => { socket.off("insight_update", handleInsightUpdate); socket.off("insight_error", handleInsightError); if (activeSubRef.current) { socket.emit("unsubscribe_insight", activeSubRef.current); activeSubRef.current = null; } };
  }, [socket, isConnected, activeSymbol, activeInterval, riskPercent, riskRewardRatio]);

  const payload = insight?.aiInsight ?? null;
  const sections = payload ? ([ payload.marketStatus && { title: "Market Status & Bias", body: cleanText(payload.marketStatus) }, payload.analysis && { title: "Strict Technical Confluence", body: cleanText(payload.analysis) }, payload.conditionalSetup && { title: "Setup Requirement", body: cleanText(payload.conditionalSetup) }, ].filter(Boolean) as { title: string; body: string }[]) : [];
  
  const confidence = payload?.confidence; const tradePosition = payload?.tradePosition ?? null; const hasActionableTrade = !!tradePosition && confidence !== "LOW";
  const riskAmountUSD = tradePosition ? accountBalance * (riskPercent / 100) : 0; const stopDistance = tradePosition ? Math.abs(tradePosition.entry - tradePosition.stopLoss) : 0; const positionSize = stopDistance > 0 ? riskAmountUSD / stopDistance : 0;
  const profitBreakdown = tradePosition && positionSize > 0 ? calculateProfitBreakdown(activeSymbol, tradePosition.entry, tradePosition.stopLoss, tradePosition.target, positionSize) : null;

  const handleConfirmAiAlertCreation = async () => {
    if (!tradePosition) return;
    if (!userId) { setModalStep("closed"); openAlertModal({ symbol: activeSymbol, suggestedPrice: tradePosition.target, condition: "ABOVE", rationale: cleanText("Orion AI risk-managed target configuration."), }); return; }
    setIsSubmittingAlert(true); 
    try { await alertService.createAlert({ userId, symbol: activeSymbol, condition: "ABOVE", thresholdValue: tradePosition.target, }); setAlertSuccessMsg(`Alert successfully created for ${activeSymbol} at $${formatPrice(tradePosition.target)}!`); setModalStep("success"); setTimeout(() => setModalStep("closed"), 3000); } 
    catch (err: any) { setModalStep("closed"); openAlertModal({ symbol: activeSymbol, suggestedPrice: tradePosition.target, condition: "ABOVE", rationale: cleanText("Orion AI risk-managed target configuration."), }); } 
    finally { setIsSubmittingAlert(false); }
  };
  
  const handleChooseNoCustom = () => { setModalStep("closed"); openAlertModal({ symbol: activeSymbol, suggestedPrice: undefined, condition: "ABOVE", rationale: cleanText("Custom user alert target level."), }); };

  return (
    <>
      {modalStep !== "closed" && tradePosition && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <Card className="w-full max-w-sm bg-zinc-950 border-zinc-800 shadow-2xl p-0 text-zinc-100">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <span className="font-bold text-zinc-100 text-sm">{modalStep === "success" ? "Alert Confirmed" : "Price Alert Configuration"}</span>
                <Button variant="ghost" size="icon" onClick={() => setModalStep("closed")} className="text-zinc-500 hover:text-zinc-300 h-6 w-6">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {modalStep === "choose_ai_or_custom" && (
                <div className="space-y-4">
                  <p className="text-zinc-300 text-xs leading-relaxed">Would you like to set your alert at Orion&apos;s target of <strong className="text-blue-400">${formatPrice(tradePosition.target)}</strong>?</p>
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button onClick={() => setModalStep("confirm_ai_target")} className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">Yes</Button>
                    <Button variant="outline" onClick={handleChooseNoCustom} className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 text-xs font-bold">No, Custom</Button>
                  </div>
                </div>
              )}
              {modalStep === "confirm_ai_target" && (
                <div className="space-y-4">
                  <p className="text-zinc-300 text-xs leading-relaxed">Are you sure you want to set the alert for <strong className="text-zinc-100">{activeSymbol}</strong> at target price <strong className="text-blue-400">${formatPrice(tradePosition.target)}</strong>?</p>
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button onClick={handleConfirmAiAlertCreation} disabled={isSubmittingAlert} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">{isSubmittingAlert ? "Setting..." : "Yes, Create"}</Button>
                    <Button variant="outline" onClick={() => setModalStep("choose_ai_or_custom")} disabled={isSubmittingAlert} className="border-zinc-700 bg-zinc-900 text-zinc-300 text-xs font-bold">Back</Button>
                  </div>
                </div>
              )}
              {modalStep === "success" && (
                <div className="space-y-3 py-2 text-center">
                  <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-base">✓</div>
                  <p className="text-zinc-200 text-xs font-medium leading-relaxed">{alertSuccessMsg}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      <aside className="w-full h-full bg-black flex flex-col p-5 font-mono text-xs overflow-y-auto relative custom-scrollbar text-zinc-100">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-4 shrink-0">
          <div className="font-bold tracking-wide">Orion Intelligence (Risk Guard)</div>
          <Badge variant="outline" className="text-[10px] text-zinc-400 bg-zinc-900/80 border-zinc-800 px-2.5 py-1 rounded-md">{activeSymbol} ({activeInterval})</Badge>
        </div>
        <div className="flex-1 flex flex-col space-y-4">
          {!isConnected ? (
            <Card className="p-4 bg-zinc-950/50 border-zinc-800 rounded-xl text-zinc-500 text-[11px]">Connecting to live feed...</Card>
          ) : isLoading ? (
            <Card className="p-6 bg-zinc-950/50 border-zinc-800 rounded-xl space-y-3 mt-2">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span className="text-blue-400 font-bold">Selectivity Scan</span>
                <Badge variant="outline" className="w-2 h-2 bg-blue-500 rounded-full animate-ping p-0 border-0" />
              </div>
              <p className="text-zinc-200 text-sm font-medium transition-all duration-300">{THINKING_STEPS[currentStepIndex]}</p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">Filtering false breakouts and checking discount/premium structure...</p>
            </Card>
          ) : error ? (
            <Card className="p-4 bg-red-500/10 border-red-500/20 rounded-xl text-red-400 space-y-2 mt-2">
              <div className="font-bold">Synthesis Interrupted</div>
              <p className="text-[11px] text-red-300/80 leading-relaxed">{cleanText(error)}</p>
            </Card>
          ) : payload ? (
            <div className="space-y-4 pb-6">
              {insight?.indicators && (
                <div className="grid grid-cols-2 gap-3">
                  <Card className="p-3 bg-zinc-950 border-zinc-800 rounded-xl flex items-center justify-between">
                    <span className="text-zinc-400 flex items-center gap-1.5 text-[11px]"><Activity className="w-3.5 h-3.5 text-blue-400" /> RSI</span>
                    <span className="font-bold text-zinc-200 font-mono text-sm">{insight.indicators.rsi != null ? insight.indicators.rsi.toFixed(1) : "N/A"}</span>
                  </Card>
                  <Card className="p-3 bg-zinc-950 border-zinc-800 rounded-xl flex items-center justify-between">
                    <span className="text-zinc-400 flex items-center gap-1.5 text-[11px]"><TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> SMA</span>
                    <span className="font-bold text-zinc-200 font-mono text-sm">{insight.indicators.sma != null ? formatPrice(insight.indicators.sma) : "N/A"}</span>
                  </Card>
                </div>
              )}

              <Badge className={`w-full justify-between px-3 py-2 rounded-xl border text-[11px] font-bold ${CONFIDENCE_STYLES[confidence as Confidence]}`}><span>Confidence</span><span>{confidence}</span></Badge>

              {hasActionableTrade && tradePosition ? (
                <>
                  <Card className="p-3.5 bg-zinc-950 border-zinc-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between text-zinc-100 font-bold">
                      <span className="flex items-center gap-1.5 text-xs"><Sliders className="w-3.5 h-3.5 text-blue-400" /> {tradePosition.side} setup</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-500">Risk % (Stop Loss)</Label>
                        <Select value={String(riskPercent)} onValueChange={(v) => { const newRisk = Number(v); setRiskConfig(newRisk, riskRewardRatio); saveRiskConfigToBackend(newRisk, riskRewardRatio); }}>
                          <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 rounded-lg p-1.5 h-8 text-zinc-200 font-mono text-xs">
                            <SelectValue placeholder="1.0" />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-300">
                            <SelectItem value="0.5">0.5% Risk</SelectItem>
                            <SelectItem value="1.0">1.0% Risk</SelectItem>
                            <SelectItem value="1.5">1.5% Risk</SelectItem>
                            <SelectItem value="2.0">2.0% Risk</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-500">Take Profit Ratio (R:R)</Label>
                        <Select value={String(riskRewardRatio)} onValueChange={(v) => { const newRatio = Number(v); setRiskConfig(riskPercent, newRatio); saveRiskConfigToBackend(riskPercent, newRatio); }}>
                          <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 rounded-lg p-1.5 h-8 text-zinc-200 font-mono text-xs">
                            <SelectValue placeholder="2.0" />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-300">
                            <SelectItem value="1.5">1 : 1.5 (Standard)</SelectItem>
                            <SelectItem value="2.0">1 : 2.0 (Optimal)</SelectItem>
                            <SelectItem value="2.5">1 : 2.5 (Extended)</SelectItem>
                            <SelectItem value="3.0">1 : 3.0 (High Target)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Separator className="bg-zinc-800" />
                    <div className="grid grid-cols-3 gap-2 pt-2 text-[11px]">
                      <div><span className="text-zinc-500">Entry:</span> <strong className="text-zinc-100">${formatPrice(tradePosition.entry)}</strong></div>
                      <div><span className="text-zinc-500">Stop:</span> <strong className="text-rose-500">${formatPrice(tradePosition.stopLoss)}</strong></div>
                      <div><span className="text-zinc-500">Target:</span> <strong className="text-emerald-500">${formatPrice(tradePosition.target)}</strong></div>
                    </div>
                  </Card>

                  <Card className="p-3.5 bg-zinc-950 border-zinc-800 rounded-xl space-y-3">
                    <div className="text-zinc-100 font-bold text-xs">Account & Position Size</div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-zinc-500">Account Balance (USD)</Label>
                      <Input type="number" min={0} value={accountBalance || ""} onChange={(e) => setAccountBalance(Number(e.target.value))} placeholder="e.g. 5000" className="w-full bg-zinc-900 border-zinc-800 rounded-lg p-1.5 h-8 text-zinc-200 font-mono text-xs placeholder:text-zinc-600" />
                    </div>
                    {accountBalance > 0 && (
                      <>
                        <Separator className="bg-zinc-800" />
                        <div className="grid grid-cols-2 gap-2 pt-2 text-[11px]">
                          <div><span className="text-zinc-500">Risking:</span> <strong className="text-rose-500">${formatPrice(riskAmountUSD)}</strong><span className="text-zinc-400"> ({riskPercent}%)</span></div>
                          <div><span className="text-zinc-500">Position size:</span> <strong className="text-emerald-500">{positionSize.toFixed(4)} units</strong></div>
                        </div>
                        {profitBreakdown && (
                          <>
                            <Separator className="bg-zinc-800" />
                            <div className="grid grid-cols-2 gap-2 pt-2 text-[11px]">
                              <div><span className="text-zinc-500">If TP hits:</span> <strong className="text-emerald-500">+${formatPrice(profitBreakdown.profitUSD)}</strong></div>
                              <div><span className="text-zinc-500">If SL hits:</span> <strong className="text-rose-500">-${formatPrice(profitBreakdown.lossUSD)}</strong></div>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </Card>
                </>
              ) : (
                <Card className="p-4 bg-zinc-950 border-dashed border-zinc-800 rounded-xl flex items-start gap-2.5">
                  <ShieldOff className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-zinc-300 font-bold text-xs">No high-conviction setup right now</div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed mt-1">
                      {confidence === "LOW" && tradePosition ? "The AI found a directional bias but flagged it low-confidence, so no trade is shown." : "Market structure doesn't meet the discount/premium or risk criteria for a trade."}
                    </p>
                  </div>
                </Card>
              )}

              <div className="space-y-3">
                {sections.map((sec, idx) => (
                  <Card key={idx} className="p-3.5 bg-zinc-950 border-zinc-800/80 rounded-xl space-y-1.5">
                    <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wide">{idx + 1}. {sec.title}</div>
                    <p className="text-zinc-300 text-xs leading-relaxed">{sec.body}</p>
                  </Card>
                ))}
              </div>

              {hasActionableTrade && tradePosition && (
                <div className="pt-2">
                  <Button onClick={() => setModalStep("choose_ai_or_custom")} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-blue-500/20 h-10">
                    Set Alert on Target (${formatPrice(tradePosition.target)})
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-16 text-zinc-500 space-y-2">
              <p>Initializing telemetry for <strong className="text-zinc-300">{activeSymbol}</strong>...</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}