"use client";

import React, {
  useEffect,
  useRef,
  useState,
  Component,
  ReactNode,
  useCallback,
} from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  CandlestickSeries,
  UTCTimestamp,
  CrosshairMode,
  LineStyle,
  LogicalRange,
  Logical,
} from "lightweight-charts";
import {
  useMarketStore,
  TradePosition,
  ConfirmedTrade,
} from "../store/useMarketStore";
import { useAuthStore } from "../store/useAuthStore";
import { useSocket } from "../providers/SocketProvider";
import { RulerOverlay } from "./RulerOverlay";
import { DrawingsOverlay, AiDrawing } from "./DrawingsOverlay";
import { positionService, UserPosition } from "../service/positionService";
import { Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// ==========================================
// TYPES
// ==========================================

type ResizeHandle = "move" | "target" | "stop" | "width";

/** Raw candle shape coming off the socket — fields are loosely typed
 * because the backend may send numbers or numeric strings interchangeably
 * depending on the data provider (Binance vs Yahoo vs TwelveData). */
interface RawCandle {
  time?: number | string;
  timestamp?: number | string;
  datetime?: number | string;
  open: any;
  high: any;
  low: any;
  close: any;
}

/** Shape of the tradePosition block inside an insight_update payload.
 * entry/stopLoss/target are typed any since Gemini's JSON response is
 * parsed externally and numeric coercion happens on our side. */
interface AiTradePositionRaw {
  side?: string;
  entry: any;
  stopLoss: any;
  target: any;
}

interface AiInsightSocketPayload {
  symbol: string;
  interval?: string;
  timestamp?: number | string;
  aiInsight?: {
    drawings?: AiDrawing[];
    tradePosition?: AiTradePositionRaw | null;
    confidence?: "LOW" | "MEDIUM" | "HIGH";
  };
}

interface OverlayCoords {
  x: number;
  y: number;
  width: number;
  height: number;
  yEntry: number;
  yTarget: number;
  yStop: number;
  targetIsAbove: boolean;
  side: "LONG" | "SHORT";
  entry: number;
  target: number;
  stopLoss: number;
}

const cleanSymbol = (sym?: string): string =>
  sym?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? "";

function toUnixSeconds(time: any): UTCTimestamp {
  if (typeof time === "number") {
    return (
      time > 1e10 ? Math.floor(time / 1000) : Math.floor(time)
    ) as UTCTimestamp;
  }
  if (typeof time === "string") {
    const parsed = new Date(time).getTime();
    if (!isNaN(parsed)) return Math.floor(parsed / 1000) as UTCTimestamp;
  }
  if (time instanceof Date)
    return Math.floor(time.getTime() / 1000) as UTCTimestamp;
  return Math.floor(Date.now() / 1000) as UTCTimestamp;
}

function checkIsDarkMode(): boolean {
  if (typeof window === "undefined") return true;
  return (
    document.documentElement.classList.contains("dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// ==========================================
// ERROR BOUNDARY
// ==========================================

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}
class ChartErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-150 bg-slate-950 border border-slate-800 rounded-xl p-6 text-center">
          <p className="text-red-500 font-medium text-sm mb-2">
            Failed to render chart
          </p>
          <p className="text-slate-500 text-xs font-mono mb-4">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 text-xs bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 transition-colors"
          >
            Reset Chart
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==========================================
// MAIN CHART CONTENT
// ==========================================

function ChartContent() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const isHistoryLoadedRef = useRef<boolean>(false);
  const allCandlesRef = useRef<CandlestickData[]>([]);
  const earliestLoadedTimeRef = useRef<number | null>(null);
  const isFetchingOlderRef = useRef<boolean>(false);
  const noMoreHistoryRef = useRef<boolean>(false);

  const [isChartReady, setIsChartReady] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);

  // Per-box horizontal anchor (bar logical index). Unrestricted — a box
  // can be dragged arbitrarily far from currently loaded candles.
  const positionLogicalIndexRef = useRef<Map<string, number>>(new Map());
  // Per-box pixel width, tracked independently so resizing one box never
  // affects any other.
  const boxWidthRef = useRef<Map<string, number>>(new Map());

  const [renderKey, setRenderKey] = useState<number>(0);
  const [isDrawMode, setIsDrawMode] = useState<boolean>(false);
  const userHasEditedActivePositionRef = useRef<boolean>(false);

  const {
    activeSymbol,
    activeInterval,
    riskPercent,
    riskRewardRatio,
    activePosition,
    setActivePosition,
    aiDrawings,
    setAiDrawings,
    confirmedTrades,
    addConfirmedTrade,
    removeConfirmedTrade,
    updateConfirmedTrade,
  } = useMarketStore();

  const userId: string | undefined = useAuthStore((state) => state.user?.id);
  const { socket, isConnected } = useSocket();

  // ---- Listen for AI insight pushes ----
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleInsightUpdate = (payload: AiInsightSocketPayload) => {
      if (!payload) return;

      const payloadSym = cleanSymbol(payload.symbol);
      const currentSym = cleanSymbol(activeSymbol);
      if (payloadSym !== currentSym) return;

      setIsRegenerating(false);

      if (payload.aiInsight?.drawings) {
        setAiDrawings(payload.aiInsight.drawings);
      }

      const trade = payload.aiInsight?.tradePosition;
      if (trade) {
        if (userHasEditedActivePositionRef.current) {
          console.log(
            "[Chart] Skipping AI update — user is editing the current suggestion",
          );
          return;
        }
        const entry = Number(trade.entry);
        const stopLoss = Number(trade.stopLoss);
        const target = Number(trade.target);

        if (
          !Number.isFinite(entry) ||
          !Number.isFinite(stopLoss) ||
          !Number.isFinite(target)
        ) {
          return;
        }

        const side: "LONG" | "SHORT" =
          (trade.side?.toUpperCase() as "LONG" | "SHORT") ||
          (target > entry ? "LONG" : "SHORT");
        const lastCandle =
          allCandlesRef.current[allCandlesRef.current.length - 1];
        const startTime: UTCTimestamp = lastCandle
          ? (lastCandle.time as UTCTimestamp)
          : toUnixSeconds(payload.timestamp || Date.now());

        setActivePosition({ side, entry, stopLoss, target, time: startTime });
      } else {
        // AI explicitly returned no setup this round — clear any pending
        // (undrawn) suggestion rather than leaving a stale one displayed.
        setActivePosition(null);
      }
    };

    socket.on("insight_update", handleInsightUpdate);
    return () => {
      socket.off("insight_update", handleInsightUpdate);
    };
  }, [socket, isConnected, activeSymbol, setActivePosition, setAiDrawings]);

  // Manual "ask again" — forces an immediate re-subscribe instead of
  // waiting for the periodic backend refresh cycle.
  const handleRegenerateInsight = useCallback(() => {
    if (!socket || !isConnected) return;
    setIsRegenerating(true);
    socket.emit("subscribe_insight", {
      symbol: activeSymbol,
      interval: activeInterval,
      riskPercent,
      riskRewardRatio,
    });
  }, [
    socket,
    isConnected,
    activeSymbol,
    activeInterval,
    riskPercent,
    riskRewardRatio,
  ]);

  /** Resolves current data for whichever box is being interacted with —
   * either the single pending AI suggestion, or a specific confirmed
   * trade. Every drag/resize/delete operation goes through this so it
   * always acts on the correct box. */
  const getPositionById = useCallback(
    (id: string): TradePosition | null => {
      if (id === "active-ai-position") return activePosition;
      const trade = confirmedTrades.find((t: ConfirmedTrade) => t.id === id);
      if (!trade) return null;
      return {
        side: trade.side,
        entry: trade.entry,
        stopLoss: trade.stopLoss,
        target: trade.target,
        time: toUnixSeconds(trade.createdAt),
      };
    },
    [activePosition, confirmedTrades],
  );

  const handleCancelPosition = useCallback(
    async (id: string): Promise<void> => {
      positionLogicalIndexRef.current.delete(id);
      boxWidthRef.current.delete(id);

      if (id === "active-ai-position") {
        setActivePosition(null);
        userHasEditedActivePositionRef.current = false;
        return;
      }
      const trade = confirmedTrades.find((t: ConfirmedTrade) => t.id === id);
      removeConfirmedTrade(id);

      if (trade?.dbId && userId) {
        try {
          await positionService.deletePosition(trade.dbId, userId);
        } catch (error: any) {
          console.error("Failed to delete position from backend:", error);
        }
      }
    },
    [setActivePosition, removeConfirmedTrade, confirmedTrades, userId],
  );

  const handleInstantDraw = useCallback(async (): Promise<void> => {
    if (!activePosition || !isChartReady) return;

    const localId = `confirmed-trade-${Date.now()}`;
    const createdAt: number =
      typeof activePosition.time === "number"
        ? activePosition.time
        : Math.floor(Date.now() / 1000);

    addConfirmedTrade({
      id: localId,
      symbol: activeSymbol,
      interval: activeInterval,
      side: activePosition.side,
      entry: activePosition.entry,
      stopLoss: activePosition.stopLoss,
      target: activePosition.target,
      confidence: "HIGH",
      createdAt,
    });
    userHasEditedActivePositionRef.current = false;

    if (userId) {
      try {
        const saved = await positionService.savePosition({
          userId,
          symbol: activeSymbol,
          interval: activeInterval,
          side: activePosition.side,
          entry: activePosition.entry,
          target: activePosition.target,
          stopLoss: activePosition.stopLoss,
          time: createdAt,
          createdAt,
        });
        updateConfirmedTrade(localId, { dbId: String(saved.id) });
      } catch (error: any) {
        console.error("Error saving user position:", error);
      }
    }

    setIsDrawMode(false);
  }, [
    activePosition,
    activeSymbol,
    activeInterval,
    addConfirmedTrade,
    updateConfirmedTrade,
    userId,
    isChartReady,
  ]);

  // ---- Load saved user positions ----
  useEffect(() => {
    if (!isChartReady || !userId) return;

    const fetchUserPositions = async (): Promise<void> => {
      try {
        const data: UserPosition[] = await positionService.getPositions(
          userId,
          activeSymbol,
        );
        data.forEach((pos: UserPosition) => {
          addConfirmedTrade({
            id: `confirmed-trade-${pos.id}`,
            dbId: String(pos.id),
            symbol: pos.symbol,
            interval: pos.interval,
            side: pos.side,
            entry: Number(pos.entry),
            stopLoss: Number(pos.stopLoss),
            target: Number(pos.target),
            confidence: "HIGH",
            createdAt: Math.floor(
              new Date(pos.created_at || Date.now()).getTime() / 1000,
            ),
          });
        });
      } catch (error: any) {
        console.error("Failed to load saved positions:", error);
      }
    };

    fetchUserPositions();
  }, [isChartReady, userId, activeSymbol, addConfirmedTrade]);

  // ---- Re-render on scroll to keep overlays pinned ----
  useEffect(() => {
    if (!isChartReady || !chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const handleScroll = (): void => setRenderKey((prev) => prev + 1);
    timeScale.subscribeVisibleLogicalRangeChange(handleScroll);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handleScroll);
  }, [isChartReady]);

  const calculatePositionOverlay = useCallback(
    (id: string, position: TradePosition): OverlayCoords | null => {
      if (
        !chartRef.current ||
        !candlestickSeriesRef.current ||
        !chartContainerRef.current
      )
        return null;

      const timeScale = chartRef.current.timeScale();
      const series = candlestickSeriesRef.current;

      let logicalIndex = positionLogicalIndexRef.current.get(id);

      if (logicalIndex === undefined) {
        const indexFromTime = timeScale.timeToIndex(position.time);
        if (indexFromTime === null || indexFromTime === -1) {
          const visibleRange = timeScale.getVisibleLogicalRange();
          logicalIndex = visibleRange
            ? Math.max(0, Math.floor(visibleRange.to - 40))
            : 0;
        } else {
          logicalIndex = indexFromTime;
        }
        positionLogicalIndexRef.current.set(id, logicalIndex);
      }

      let xStart:any = timeScale.logicalToCoordinate(logicalIndex as Logical);
      if (xStart === null) xStart = 0;

      const yEntry = series.priceToCoordinate(position.entry);
      const yTarget = series.priceToCoordinate(position.target);
      const yStop = series.priceToCoordinate(position.stopLoss);
      if (yEntry === null || yTarget === null || yStop === null) return null;

      const width = boxWidthRef.current.get(id) ?? 180;
      const x = Number(xStart);
      const minY = Math.min(yEntry, yTarget, yStop);
      const maxY = Math.max(yEntry, yTarget, yStop);
      const y = Number(minY);
      const height = Math.max(maxY - minY, 40);

      const side: "LONG" | "SHORT" =
        position.side || (position.target > position.entry ? "LONG" : "SHORT");
      const targetIsAbove = side === "LONG";

      return {
        x,
        y,
        width,
        height,
        yEntry: Number(yEntry),
        yTarget: Number(yTarget),
        yStop: Number(yStop),
        targetIsAbove,
        side,
        entry: Number(position.entry),
        target: Number(position.target),
        stopLoss: Number(position.stopLoss),
      };
    },
    [renderKey],
  );

  /** Unified drag/resize/delete handler for any box (AI suggestion or
   * confirmed trade). Always resolves the correct starting state via
   * getPositionById — never reads a stale/shared closure.
   *
   * - 'move': full 2D — entry follows cursor price (Y) and bar position
   *   (X), unrestricted; target/stop keep fixed offset from entry.
   * - 'target' / 'stop': vertical-only, adjusts just that line.
   * - 'width': horizontal-only, purely visual (pixel width), never
   *   touches price/time or persistence.
   */
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, id: string, handleType: ResizeHandle): void => {
      e.preventDefault();
      e.stopPropagation();

      const isAi = id === "active-ai-position";
      const series = candlestickSeriesRef.current;
      const timeScale = chartRef.current?.timeScale();
      const container = chartContainerRef.current;
      if (!series || !timeScale || !container) return;

      const start = getPositionById(id);
      if (!start) return;

      if (id === "active-ai-position") {
        userHasEditedActivePositionRef.current = true;
      }

      const startMouseX = e.clientX;
      const startWidth = boxWidthRef.current.get(id) ?? 180;
      const startLogical = positionLogicalIndexRef.current.get(id) ?? 0;

      const offsetTarget = start.target - start.entry;
      const offsetStop = start.stopLoss - start.entry;

      let latestEntry = start.entry;
      let latestTarget = start.target;
      let latestStop = start.stopLoss;
      let latestLogical = startLogical;
      let logicalChanged = false;

      const onMouseMove = (moveEvent: MouseEvent): void => {
        const rect = container.getBoundingClientRect();
        const mouseY = moveEvent.clientY - rect.top;
        const deltaX = moveEvent.clientX - startMouseX;

        if (handleType === "width") {
          const newWidth = Math.max(40, startWidth + deltaX);
          boxWidthRef.current.set(id, newWidth);
          setRenderKey((k) => k + 1);
          return;
        }

        if (handleType === "target") {
          const newPrice = series.coordinateToPrice(mouseY);
          if (newPrice === null) return;
          latestTarget = Number(newPrice);
          if (isAi) {
            setActivePosition({ ...start, target: latestTarget });
          } else {
            updateConfirmedTrade(id, { target: latestTarget });
          }
          setRenderKey((k) => k + 1);
          return;
        }

        if (handleType === "stop") {
          const newPrice = series.coordinateToPrice(mouseY);
          if (newPrice === null) return;
          latestStop = Number(newPrice);
          if (isAi) {
            setActivePosition({ ...start, stopLoss: latestStop });
          } else {
            updateConfirmedTrade(id, { stopLoss: latestStop });
          }
          setRenderKey((k) => k + 1);
          return;
        }

        // 'move' — full 2D, unrestricted range
        const newPrice = series.coordinateToPrice(mouseY);
        if (newPrice === null) return;

        const newEntry = Number(newPrice);
        const newTarget = newEntry + offsetTarget;
        const newStop = newEntry + offsetStop;

        const visibleRange = timeScale.getVisibleLogicalRange();
        if (visibleRange) {
          const startCoord = timeScale.logicalToCoordinate(visibleRange.from);
          const endCoord = timeScale.logicalToCoordinate(visibleRange.to);
          if (startCoord !== null && endCoord !== null) {
            const span = visibleRange.to - visibleRange.from;
            const avgBarWidth = span > 0 ? (endCoord - startCoord) / span : 0;
            if (avgBarWidth > 0) {
              const barsMoved = Math.round(deltaX / avgBarWidth);
              latestLogical = startLogical + barsMoved;
              logicalChanged = true;
              positionLogicalIndexRef.current.set(id, latestLogical);
            }
          }
        }

        latestEntry = newEntry;
        latestTarget = newTarget;
        latestStop = newStop;

        if (isAi) {
          setActivePosition({
            ...start,
            entry: newEntry,
            target: newTarget,
            stopLoss: newStop,
          });
        } else {
          updateConfirmedTrade(id, {
            entry: newEntry,
            target: newTarget,
            stopLoss: newStop,
          });
        }
        setRenderKey((k) => k + 1);
      };

      const onMouseUp = async (): Promise<void> => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);

        if (handleType === "width") return;

        let finalTime: UTCTimestamp = start.time;
        if (logicalChanged) {
          const coord = timeScale.logicalToCoordinate(latestLogical as Logical);
          if (coord !== null) {
            const t = timeScale.coordinateToTime(coord);
            if (t !== null) finalTime = t as UTCTimestamp;
          }
        }

        if (isAi) {
          setActivePosition({
            side: start.side,
            entry: latestEntry,
            target: latestTarget,
            stopLoss: latestStop,
            time: finalTime,
          });
          return;
        }

        if (logicalChanged) {
          updateConfirmedTrade(id, { createdAt: finalTime });
        }

        if (!userId) return;
        const existingTrade = confirmedTrades.find(
          (t: ConfirmedTrade) => t.id === id,
        );

        const payload = {
          userId,
          symbol: activeSymbol,
          interval: activeInterval,
          side: start.side,
          entry: latestEntry,
          target: latestTarget,
          stopLoss: latestStop,
          time: finalTime,
          createdAt: finalTime,
        };

        try {
          if (existingTrade?.dbId) {
            const updated = await positionService.updatePosition(
              existingTrade.dbId,
              userId,
              payload,
            );
            updateConfirmedTrade(id, { dbId: String(updated.id) });
          } else {
            const saved = await positionService.savePosition(payload);
            updateConfirmedTrade(id, { dbId: String(saved.id) });
          }
        } catch (error: any) {
          console.error("Failed to persist position change:", error);
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [
      getPositionById,
      setActivePosition,
      updateConfirmedTrade,
      confirmedTrades,
      userId,
      activeSymbol,
      activeInterval,
    ],
  );

  const renderPositionOverlay = useCallback((): ReactNode => {
    if (!isChartReady) return null;

    const positionsToRender: { id: string; position: TradePosition }[] = [];

    if (activePosition) {
      positionsToRender.push({
        id: "active-ai-position",
        position: activePosition,
      });
    }

    confirmedTrades
      .filter((t: ConfirmedTrade) => t.symbol === activeSymbol)
      .forEach((trade: ConfirmedTrade) => {
        positionsToRender.push({
          id: trade.id,
          position: {
            side: trade.side,
            entry: Number(trade.entry),
            stopLoss: Number(trade.stopLoss),
            target: Number(trade.target),
            time: toUnixSeconds(trade.createdAt),
          },
        });
      });

    if (positionsToRender.length === 0) return null;

    return positionsToRender.map((item) => {
      const coords = calculatePositionOverlay(item.id, item.position);
      if (!coords) return null;

      const {
        x,
        y,
        width,
        height,
        yEntry,
        yTarget,
        yStop,
        targetIsAbove,
        side,
        entry,
        target,
        stopLoss,
      } = coords;

      const targetAreaHeight = Math.abs(yEntry - yTarget);
      const stopAreaHeight = Math.abs(yEntry - yStop);
      const targetTop = targetIsAbove ? 0 : stopAreaHeight;
      const stopTop = targetIsAbove ? targetAreaHeight : 0;

      const riskDist = Math.abs(entry - stopLoss);
      const rewardDist = Math.abs(target - entry);
      const rrRatio =
        riskDist > 0 ? (rewardDist / riskDist).toFixed(2) : "0.00";

      return (
        <div
          key={item.id}
          className="absolute pointer-events-auto group z-50 cursor-grab active:cursor-grabbing"
          style={{ left: x, top: y, width, height }}
          onMouseDown={(e) => handleResizeStart(e, item.id, "move")}
        >
          <div
            className="absolute border border-emerald-500/60 bg-emerald-500/20"
            style={{ top: targetTop, height: targetAreaHeight, width: "100%" }}
          >
            <div className="absolute top-1 right-2 text-[10px] text-emerald-400 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
              Target: ${Number(target).toFixed(2)}
            </div>
            <div
              className="absolute -top-2 -right-2 w-3 h-3 bg-white border border-blue-500 cursor-ns-resize rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => handleResizeStart(e, item.id, "target")}
            />
          </div>

          <div
            className="absolute border border-rose-500/60 bg-rose-500/20"
            style={{ top: stopTop, height: stopAreaHeight, width: "100%" }}
          >
            <div className="absolute top-1 right-2 text-[10px] text-rose-400 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
              Stop: ${Number(stopLoss).toFixed(2)}
            </div>
            <div
              className="absolute -bottom-2 -right-2 w-3 h-3 bg-white border border-blue-500 cursor-ns-resize rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => handleResizeStart(e, item.id, "stop")}
            />
          </div>

          <div
            className="absolute w-full border-t border-slate-400 border-dashed"
            style={{ top: yEntry - y }}
          >
            <div className="absolute -top-3.5 left-2 text-[10px] text-slate-300 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
              {side} @ ${Number(entry).toFixed(2)}
            </div>
            <div className="absolute -top-3.5 right-2 text-[10px] text-slate-300 font-mono bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
              R:R {rrRatio}
            </div>

            <div
              className="absolute -top-2 -left-2 w-3 h-3 bg-white border border-blue-500 cursor-move rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => handleResizeStart(e, item.id, "move")}
            />
            <div
              className="absolute -top-2 right-2 w-3 h-3 bg-white border border-blue-500 cursor-ew-resize rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => handleResizeStart(e, item.id, "width")}
            />
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCancelPosition(item.id);
            }}
            className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-slate-800 border border-slate-600 text-slate-300 hover:bg-red-500 hover:border-red-400 hover:text-white flex items-center justify-center text-[10px] font-bold transition-colors shadow-lg z-10"
          >
            ✕
          </button>
        </div>
      );
    });
  }, [
    activePosition,
    confirmedTrades,
    activeSymbol,
    calculatePositionOverlay,
    handleCancelPosition,
    isChartReady,
    handleResizeStart,
  ]);

  // ---- Setup chart ----
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    const initialDark = checkIsDarkMode();

    const chart = createChart(container, {
      layout: {
        background: {
          type: ColorType.Solid,
          color: initialDark ? "#020617" : "#ffffff",
        },
        textColor: initialDark ? "#94a3b8" : "#334155",
      },
      grid: {
        vertLines: { color: initialDark ? "#0f172a" : "#f1f5f9" },
        horzLines: { color: initialDark ? "#0f172a" : "#f1f5f9" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#64748b",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#0f172a",
        },
        horzLine: {
          color: "#64748b",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#0f172a",
        },
      },
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    setIsChartReady(true);

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      setIsChartReady(false);
    };
  }, []);

  const fetchOlderCandles = useCallback((): void => {
    if (!socket || !isConnected) return;
    if (isFetchingOlderRef.current || noMoreHistoryRef.current) return;
    if (earliestLoadedTimeRef.current == null) return;

    isFetchingOlderRef.current = true;
    setIsLoadingOlder(true);
    socket.emit("get_older_klines", {
      symbol: activeSymbol,
      interval: activeInterval,
      beforeTime: earliestLoadedTimeRef.current,
    });
  }, [socket, isConnected, activeSymbol, activeInterval]);

  useEffect(() => {
    if (!isChartReady || !chartRef.current) return;
    const timeScale = chartRef.current.timeScale();

    const handleRangeChange = (range: LogicalRange | null): void => {
      if (!range) return;
      if (range.from < 15) fetchOlderCandles();
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () =>
      timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
  }, [isChartReady, fetchOlderCandles]);

  useEffect(() => {
    if (!isConnected || !socket) return;

    setIsLoading(true);
    setIsEmpty(false);

    allCandlesRef.current = [];
    earliestLoadedTimeRef.current = null;
    isFetchingOlderRef.current = false;
    noMoreHistoryRef.current = false;
    setIsLoadingOlder(false);

    socket.emit("subscribe_symbol", activeSymbol, activeInterval);
    socket.emit("get_klines", {
      symbol: activeSymbol,
      interval: activeInterval,
    });

    const handleKlinesHistory = (history: RawCandle[]): void => {
      if (!candlestickSeriesRef.current) return;
      if (!Array.isArray(history) || history.length === 0) {
        setIsLoading(false);
        setIsEmpty(true);
        return;
      }

      const rawFormatted: CandlestickData[] = history
        .map((c: RawCandle) => ({
          time: toUnixSeconds(c.time ?? c.timestamp ?? c.datetime),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }))
        .filter((c) => !isNaN(c.time as number))
        .sort((a, b) => (a.time as number) - (b.time as number));

      allCandlesRef.current = rawFormatted;
      earliestLoadedTimeRef.current = rawFormatted[0]?.time as number;

      candlestickSeriesRef.current.setData(rawFormatted);
      isHistoryLoadedRef.current = true;
      chartRef.current?.timeScale().fitContent();

      setIsLoading(false);
    };

    const handleKlineUpdate = (candle: RawCandle): void => {
      if (!candlestickSeriesRef.current || !isHistoryLoadedRef.current) return;
      const candleTime = toUnixSeconds(
        candle.time ?? candle.timestamp ?? candle.datetime,
      );
      const updated: CandlestickData = {
        time: candleTime,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      };

      candlestickSeriesRef.current.update(updated);

      const idx = allCandlesRef.current.findIndex((c) => c.time === candleTime);
      if (idx >= 0) {
        allCandlesRef.current[idx] = updated;
      } else {
        allCandlesRef.current.push(updated);
      }
    };

    socket.on("klines_history", handleKlinesHistory);
    socket.on("kline_update", handleKlineUpdate);

    return () => {
      socket.emit("unsubscribe_symbol", activeSymbol);
      socket.off("klines_history", handleKlinesHistory);
      socket.off("kline_update", handleKlineUpdate);
    };
  }, [activeSymbol, activeInterval, isConnected, socket]);

   return (
    <div className="relative w-full h-full flex-1 min-h-100 md:min-h-150 bg-black border border-zinc-800 rounded-xl overflow-hidden p-2 flex flex-col">
      {/* TOOLBAR UPDATES USING ZINC */}
      <div className="absolute top-3 left-3 z-40 flex items-center gap-2 pointer-events-auto">
        <Button
          onClick={() => {
            if (isDrawMode) {
              setIsDrawMode(false);
            } else {
              handleInstantDraw();
            }
          }}
          disabled={isLoading}
          variant="outline"
          className={`px-3 py-1.5 h-8 rounded-lg text-[11px] font-bold transition-colors shadow-lg flex items-center gap-1.5 border-zinc-800 ${
            isDrawMode
              ? 'bg-rose-600/20 text-rose-400 border-rose-600/40 hover:bg-rose-600/30'
              : activePosition
              ? 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border-zinc-700'
              : 'bg-zinc-950 text-zinc-500 border-zinc-800 cursor-not-allowed'
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          {!activePosition ? 'No AI Setup' : (isDrawMode ? 'Cancel' : 'Draw Setup')}
        </Button>

        <Button
          onClick={handleRegenerateInsight}
          disabled={isRegenerating || !isConnected}
          variant="outline"
          className="px-3 py-1.5 h-8 rounded-lg text-[11px] font-bold transition-colors shadow-lg flex items-center gap-1.5 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border-zinc-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
          {isRegenerating ? 'Asking Orion...' : 'New AI Setup'}
        </Button>

        {isDrawMode && (
          <div className="bg-zinc-950/95 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-[10px] text-emerald-400 font-mono shadow-xl backdrop-blur-md">
            Setup drawn! Drag the white handles to adjust.
          </div>
        )}
      </div>

      {activePosition && !isDrawMode && (
        <div className="absolute top-3 right-3 z-40 flex items-center gap-2 bg-zinc-950/95 border border-zinc-700/80 rounded-lg px-3 py-1.5 shadow-xl backdrop-blur-md pointer-events-auto">
          <span className="text-[11px] font-medium text-zinc-300">
            Setup: <strong className="text-emerald-400">{activePosition.side}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCancelPosition('active-ai-position')}
            className="text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/40 rounded px-2 py-0.5 hover:bg-red-500/30 h-6"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* LOADING OVERLAYS */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90 backdrop-blur-sm text-xs font-mono text-emerald-400">
          Loading {activeSymbol} ({activeInterval})...
        </div>
      )}

      {isEmpty && !isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black text-zinc-400 text-xs font-mono">
          No chart data returned for {activeSymbol}
        </div>
      )}

      {isLoadingOlder && (
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5 bg-zinc-900/90 border border-zinc-700 rounded-md px-2 py-1 text-[10px] font-mono text-zinc-300">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Loading history...
        </div>
      )}

      <div ref={chartContainerRef} className="w-full h-full flex-1 relative">
        {isChartReady && renderPositionOverlay()}

        {isChartReady && chartRef.current && candlestickSeriesRef.current && (
          <RulerOverlay
            chartInstance={chartRef.current}
            seriesInstance={candlestickSeriesRef.current}
            containerRef={chartContainerRef}
          />
        )}

        {isChartReady &&
          chartRef.current &&
          candlestickSeriesRef.current &&
          aiDrawings?.length > 0 && (
            <DrawingsOverlay
              chartInstance={chartRef.current}
              seriesInstance={candlestickSeriesRef.current}
              drawings={aiDrawings}
            />
          )}
      </div>
    </div>
  );
}

export default function TradingViewChart(): ReactNode {
  return (
    <ChartErrorBoundary>
      <ChartContent />
    </ChartErrorBoundary>
  );
}
