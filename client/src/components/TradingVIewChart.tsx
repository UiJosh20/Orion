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
  MouseEventParams,
  LogicalRange,
} from "lightweight-charts";
import { useMarketStore, TradePosition } from "../store/useMarketStore";
import { useSocket } from "../providers/SocketProvider";
import { RulerOverlay } from "./RulerOverlay";
import { DrawingsOverlay } from "./DrawingsOverlay";
import { RefreshCw } from "lucide-react";

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

interface ErrorBoundaryProps {
  children: ReactNode;
}
class ChartErrorBoundary extends Component<
  ErrorBoundaryProps,
  { hasError: boolean; error?: Error }
> {
  state: any = { hasError: false };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-[600px] bg-slate-950 border border-slate-800 rounded-xl p-6 text-center">
          <p className="text-red-500 font-medium text-sm mb-2">
            Failed to render Orion chart
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

function ChartContent() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const isHistoryLoadedRef = useRef<boolean>(false);

  // Full merged dataset kept in a ref so we can prepend older candles
  // without re-deriving from the series each time.
  const allCandlesRef = useRef<CandlestickData[]>([]);
  const earliestLoadedTimeRef = useRef<number | null>(null);
  const isFetchingOlderRef = useRef<boolean>(false);
  const noMoreHistoryRef = useRef<boolean>(false);

  const [isChartReady, setIsChartReady] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const isHoveringChartRef = useRef<boolean>(false);

  const {
    activeSymbol,
    activeInterval,
    activePosition,
    setActivePosition,
    riskPercent,
    riskRewardRatio,
    aiDrawings,
  } = useMarketStore();
  const activePositionRef = useRef<TradePosition | null>(activePosition);
  activePositionRef.current = activePosition;

  const [overlayCoords, setOverlayCoords] = useState<{
    entryY: number;
    stopLossY: number;
    targetY: number;
    startX: number;
    width: number;
  } | null>(null);

  const { socket, isConnected } = useSocket();

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const updateCoordinates = useCallback(() => {
    const pos = activePositionRef.current;
    if (!chartRef.current || !candlestickSeriesRef.current || !pos) {
      setOverlayCoords(null);
      return;
    }
    try {
      const series = candlestickSeriesRef.current;
      const timeScale = chartRef.current.timeScale();

      const entryY = series.priceToCoordinate(pos.entry);
      const stopLossY = series.priceToCoordinate(pos.stopLoss);
      const targetY = series.priceToCoordinate(pos.target);
      const startX = timeScale.timeToCoordinate(pos.time);

      if (
        entryY !== null &&
        stopLossY !== null &&
        targetY !== null &&
        startX !== null
      ) {
        setOverlayCoords({ entryY, stopLossY, targetY, startX, width: 240 });
      } else {
        setOverlayCoords(null);
      }
    } catch (e) {
      // Ignore during chart scale transitions
    }
  }, []);

  // Requests candles older than the earliest one currently loaded.
  // Guarded against duplicate/overlapping requests and against
  // requesting past the point where the exchange has no more history.
  const fetchOlderCandles = useCallback(() => {
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

  // Initialize Canvas Chart
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
        mode: CrosshairMode.Magnet,
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

    chart.timeScale().subscribeVisibleTimeRangeChange(updateCoordinates);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateCoordinates);

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
        updateCoordinates();
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
  }, [updateCoordinates]);

  // Pan-to-edge detection: when the visible logical range's left edge
  // gets within ~15 bars of the start of loaded data, request more.
  // This is what was entirely missing before — nothing listened for
  // "user scrolled to the start of what's loaded."
  useEffect(() => {
    if (!isChartReady || !chartRef.current) return;
    const timeScale = chartRef.current.timeScale();

    const handleRangeChange = (range: LogicalRange | null) => {
      if (!range) return;
      if (range.from < 15) {
        fetchOlderCandles();
      }
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () =>
      timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
  }, [isChartReady, fetchOlderCandles]);

  // Recalculate Risk-to-Reward levels when store risk parameters change
  useEffect(() => {
    if (!activePositionRef.current || !candlestickSeriesRef.current) return;
    const current = activePositionRef.current;
    const entry = current.entry;
    const riskAmt = entry * (riskPercent / 100);
    const stopLoss = Number(
      (entry - (current.side === "LONG" ? riskAmt : -riskAmt)).toFixed(4),
    );
    const target = Number(
      (
        entry +
        (current.side === "LONG"
          ? riskAmt * riskRewardRatio
          : -(riskAmt * riskRewardRatio))
      ).toFixed(4),
    );

    if (current.stopLoss !== stopLoss || current.target !== target) {
      setActivePosition({ ...current, stopLoss, target });
      updateCoordinates();
    }
  }, [riskPercent, riskRewardRatio, setActivePosition, updateCoordinates]);

  // WebSocket Kline Streaming & History Load
  useEffect(() => {
    if (!isConnected || !socket) return;
    setIsLoading(true);
    setHasError(false);
    setIsEmpty(false);

    // Reset pagination state on symbol/interval change
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

    const handleKlinesHistory = (history: any[]) => {
      if (!candlestickSeriesRef.current) return;
      if (!Array.isArray(history) || history.length === 0) {
        setIsLoading(false);
        setIsEmpty(true);
        return;
      }

      try {
        const rawFormatted: CandlestickData[] = history
          .map((c) => ({
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
        setTimeout(updateCoordinates, 50);
      } catch (err: any) {
        console.error("[Chart History Error]:", err);
        setHasError(true);
        setIsLoading(false);
      }
    };

    // Merges an older-candle batch into the existing dataset and
    // re-applies it. setData preserves the current visible time window
    // (it's time-anchored, not index-anchored), so this doesn't jump
    // the viewport — the chart just extends leftward.
    const handleKlinesOlder = ({
      symbol,
      interval,
      candles,
    }: {
      symbol: string;
      interval: string;
      candles: any[];
    }) => {
      isFetchingOlderRef.current = false;
      setIsLoadingOlder(false);

      if (symbol !== activeSymbol || interval !== activeInterval) return;
      if (!candlestickSeriesRef.current) return;

      if (!Array.isArray(candles) || candles.length === 0) {
        noMoreHistoryRef.current = true;
        return;
      }

      const formatted: CandlestickData[] = candles
        .map((c) => ({
          time: toUnixSeconds(c.time ?? c.timestamp ?? c.datetime),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }))
        .filter((c) => !isNaN(c.time as number));

      // Merge, dedupe by time, sort ascending
      const dedupedMap = new Map<number, CandlestickData>();
      [...formatted, ...allCandlesRef.current].forEach((c) => {
        dedupedMap.set(c.time as number, c);
      });
      const sorted = Array.from(dedupedMap.values()).sort(
        (a, b) => (a.time as number) - (b.time as number),
      );

      allCandlesRef.current = sorted;
      earliestLoadedTimeRef.current = sorted[0]?.time as number;

      candlestickSeriesRef.current.setData(sorted);
    };

    const handleKlineUpdate = (candle: any) => {
      if (!candlestickSeriesRef.current || !isHistoryLoadedRef.current) return;
      const candleTime = toUnixSeconds(
        candle.time ?? candle.timestamp ?? candle.datetime,
      );
      const updated = {
        time: candleTime,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      };
      candlestickSeriesRef.current.update(updated);

      // Keep the merged ref in sync so future older-history merges
      // don't clobber the latest live candle
      const idx = allCandlesRef.current.findIndex((c) => c.time === candleTime);
      if (idx >= 0) {
        allCandlesRef.current[idx] = updated;
      } else {
        allCandlesRef.current.push(updated);
      }

      updateCoordinates();
    };

    socket.on("klines_history", handleKlinesHistory);
    socket.on("klines_older", handleKlinesOlder);
    socket.on("kline_update", handleKlineUpdate);

    return () => {
      socket.emit("unsubscribe_symbol", activeSymbol);
      socket.off("klines_history", handleKlinesHistory);
      socket.off("klines_older", handleKlinesOlder);
      socket.off("kline_update", handleKlineUpdate);
    };
  }, [activeSymbol, activeInterval, isConnected, socket, updateCoordinates]);

  useEffect(() => {
    updateCoordinates();
  }, [activePosition, updateCoordinates]);

  const riskRewardDisplay = activePosition
    ? Math.abs(
        (activePosition.target - activePosition.entry) /
          (activePosition.entry - activePosition.stopLoss),
      ).toFixed(2)
    : "0.00";
  const profitPct = activePosition
    ? (
        (Math.abs(activePosition.target - activePosition.entry) /
          activePosition.entry) *
        100
      ).toFixed(2)
    : "0.00";
  const lossPct = activePosition
    ? (
        (Math.abs(activePosition.entry - activePosition.stopLoss) /
          activePosition.entry) *
        100
      ).toFixed(2)
    : "0.00";

  const refreshChart = useCallback(() => {
    if (!socket || !isConnected) return;

    setContextMenu(null);
    setIsLoading(true);
    setHasError(false);
    setIsEmpty(false);

    // Reset pagination + history state exactly like a fresh symbol switch,
    // then re-request from scratch — this is a hard refresh, not a merge.
    allCandlesRef.current = [];
    earliestLoadedTimeRef.current = null;
    isFetchingOlderRef.current = false;
    noMoreHistoryRef.current = false;
    isHistoryLoadedRef.current = false;
    setIsLoadingOlder(false);

    socket.emit("get_klines", {
      symbol: activeSymbol,
      interval: activeInterval,
    });
  }, [socket, isConnected, activeSymbol, activeInterval]);

  // Right-click context menu + "R" keyboard shortcut, both trigger the
  // same refreshChart(). Shortcut only fires while the mouse is over the
  // chart, so it doesn't steal "R" from inputs elsewhere on the page.
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const handleMouseEnter = () => {
      isHoveringChartRef.current = true;
    };
    const handleMouseLeave = () => {
      isHoveringChartRef.current = false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable;
      if (isTyping || !isHoveringChartRef.current) return;

      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        refreshChart();
      }
    };

    const handleClickAway = () => setContextMenu(null);

    container.addEventListener("contextmenu", handleContextMenu);
    container.addEventListener("mouseenter", handleMouseEnter);
    container.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", handleClickAway);

    return () => {
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("mouseenter", handleMouseEnter);
      container.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleClickAway);
    };
  }, [refreshChart]);

  return (
    <div className="relative w-full h-full flex-1 min-h-[400px] md:min-h-[600px] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden p-2 flex flex-col">
      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm text-xs font-mono text-emerald-400">
          Loading {activeSymbol} ({activeInterval})...
        </div>
      )}

      {isEmpty && !isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950 text-slate-400 text-xs font-mono">
          No chart data returned for {activeSymbol}
        </div>
      )}

      {isLoadingOlder && (
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 bg-slate-900/90 border border-slate-700 rounded-md px-2 py-1 text-[10px] font-mono text-slate-300">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Loading history...
        </div>
      )}

      <div
        ref={chartContainerRef}
        className="w-full h-full flex-1 relative cursor-crosshair"
      >
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

      {overlayCoords && activePosition && !isLoading && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          <div
            className="absolute bg-emerald-500/20 border-t border-b border-emerald-500/70 flex items-center justify-between px-3 text-[11px] font-mono text-emerald-300 pointer-events-auto"
            style={{
              left: overlayCoords.startX,
              width: overlayCoords.width,
              top: Math.min(overlayCoords.targetY, overlayCoords.entryY),
              height: Math.abs(overlayCoords.targetY - overlayCoords.entryY),
            }}
          >
            <span>Target: {activePosition.target}</span>
            <span className="font-bold">+{profitPct}%</span>
          </div>

          <div
            className="absolute bg-rose-500/20 border-t border-b border-rose-500/70 flex items-center justify-between px-3 text-[11px] font-mono text-rose-300 pointer-events-auto"
            style={{
              left: overlayCoords.startX,
              width: overlayCoords.width,
              top: Math.min(overlayCoords.entryY, overlayCoords.stopLossY),
              height: Math.abs(overlayCoords.entryY - overlayCoords.stopLossY),
            }}
          >
            <span>Stop: {activePosition.stopLoss}</span>
            <span className="font-bold">-{lossPct}%</span>
          </div>

          <div
            className="absolute border-t-2 border-blue-500 flex items-center justify-between px-2 bg-slate-900/95 text-[10px] font-mono text-blue-300 shadow-xl pointer-events-auto"
            style={{
              left: overlayCoords.startX,
              width: overlayCoords.width,
              top: overlayCoords.entryY - 10,
              height: 20,
            }}
          >
            <span>Entry: {activePosition.entry}</span>
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white px-1.5 py-0.5 rounded text-[9px] font-bold">
                R/R: {riskRewardDisplay}
              </span>
              <button
                onClick={() => setActivePosition(null)}
                className="hover:text-red-400 font-bold transition-colors cursor-pointer"
                title="Remove Position"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="absolute z-40 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={refreshChart}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono text-slate-200 hover:bg-slate-800 transition-colors text-left"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Chart
            <span className="ml-auto text-[10px] text-slate-500">R</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function TradingViewChart() {
  return (
    <ChartErrorBoundary>
      <ChartContent />
    </ChartErrorBoundary>
  );
}
