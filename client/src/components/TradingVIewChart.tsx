'use client';

import React, {
  useEffect,
  useRef,
  useState,
  Component,
  ReactNode,
  useCallback,
} from 'react';
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
  MouseEventParams,
  Logical,
} from 'lightweight-charts';
import { useMarketStore, TradePosition } from '../store/useMarketStore';
import { useAuthStore } from '../store/useAuthStore';
import { useSocket } from '../providers/SocketProvider';
import { RulerOverlay } from './RulerOverlay';
import { DrawingsOverlay } from './DrawingsOverlay';
import { positionService, UserPosition } from '../service/positionService';
import { Pencil, X } from 'lucide-react';

// Strip slashes, spaces, and symbols for perfect matching
const cleanSymbol = (sym?: string) =>
  sym?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? "";

function toUnixSeconds(time: any): UTCTimestamp {
  if (typeof time === 'number') {
    return (time > 1e10 ? Math.floor(time / 1000) : Math.floor(time)) as UTCTimestamp;
  }
  if (typeof time === 'string') {
    const parsed = new Date(time).getTime();
    if (!isNaN(parsed)) return Math.floor(parsed / 1000) as UTCTimestamp;
  }
  if (time instanceof Date) return Math.floor(time.getTime() / 1000) as UTCTimestamp;
  return Math.floor(Date.now() / 1000) as UTCTimestamp;
}

function checkIsDarkMode(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    document.documentElement.classList.contains('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches
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
        <div className="flex flex-col items-center justify-center w-full h-150 bg-slate-950 border border-slate-800 rounded-xl p-6 text-center">
          <p className="text-red-500 font-medium text-sm mb-2">Failed to render chart</p>
          <p className="text-slate-500 text-xs font-mono mb-4">{this.state.error?.message}</p>
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
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const isHistoryLoadedRef = useRef<boolean>(false);
  const allCandlesRef = useRef<CandlestickData[]>([]);
  const earliestLoadedTimeRef = useRef<number | null>(null);
  const isFetchingOlderRef = useRef<boolean>(false);
  const noMoreHistoryRef = useRef<boolean>(false);

  const [isChartReady, setIsChartReady] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);

  const positionLogicalIndexRef = useRef<Map<string, number>>(new Map());
  const [renderKey, setRenderKey] = useState(0);
  const [boxWidth, setBoxWidth] = useState(180);

  const [isDrawMode, setIsDrawMode] = useState(false);

  const {
    activeSymbol,
    activeInterval,
    activePosition,
    setActivePosition,
    aiDrawings,
    setAiDrawings,
    confirmedTrades,
    addConfirmedTrade,
    removeConfirmedTrade,
    updateConfirmedTrade,
  } = useMarketStore();

  const userId = useAuthStore((state) => state.user?.id);
  const { socket, isConnected } = useSocket();

  // ✅ LISTEN TO AI INSIGHT SOCKET
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleInsightUpdate = (payload: any) => {
      if (!payload) return;

      const payloadSym = cleanSymbol(payload.symbol);
      const currentSym = cleanSymbol(activeSymbol);

      if (payloadSym !== currentSym) {
        console.warn(`[Chart] Mismatched symbol. Got ${payload.symbol}, expected ${activeSymbol}`);
        return;
      }

      if (payload.aiInsight?.drawings) {
        setAiDrawings(payload.aiInsight.drawings);
      }

      const trade = payload.aiInsight?.tradePosition;
      if (trade) {
        const entry = Number(trade.entry);
        const stopLoss = Number(trade.stopLoss);
        const target = Number(trade.target);
        const side = (trade.side || (target > entry ? 'LONG' : 'SHORT')).toUpperCase() as 'LONG' | 'SHORT';
        const startTime = toUnixSeconds(payload.timestamp || Date.now());

        setActivePosition({ side, entry, stopLoss, target, time: startTime });
      }
    };

    socket.on('insight_update', handleInsightUpdate);

    return () => {
      socket.off('insight_update', handleInsightUpdate);
    };
  }, [socket, isConnected, activeSymbol, setActivePosition, setAiDrawings]);

  // Handle Cancel Position
  const handleCancelPosition = useCallback(
    async (id: string) => {
      positionLogicalIndexRef.current.delete(id);

      if (id === 'active-ai-position') {
        setActivePosition(null);
        return;
      }

      const trade = confirmedTrades.find((t) => t.id === id);
      removeConfirmedTrade(id);

      if (trade?.dbId && userId) {
        try {
          await positionService.deletePosition(trade.dbId, userId);
        } catch (error) {
          console.error('Failed to delete position from backend:', error);
        }
      }
    },
    [setActivePosition, removeConfirmedTrade, confirmedTrades, userId]
  );

  // ✅ INSTANT "Draw" Button
  const handleInstantDraw = useCallback(async () => {
    if (!activePosition) return;
    if (!isChartReady) return;
    setBoxWidth(180);

    const localId = `confirmed-trade-${Date.now()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    addConfirmedTrade({
      id: localId,
      symbol: activeSymbol,
      interval: activeInterval,
      side: activePosition.side,
      entry: activePosition.entry,
      stopLoss: activePosition.stopLoss,
      target: activePosition.target,
      confidence: 'HIGH',
      createdAt,
    });

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
          time: typeof activePosition.time === 'number' ? activePosition.time : Math.floor(Date.now() / 1000),
          createdAt,
        });
        updateConfirmedTrade(localId, { dbId: String(saved.id) });
      } catch (error) {
        console.error('Error saving user position:', error);
      }
    }

    setIsDrawMode(false);
  }, [activePosition, activeSymbol, activeInterval, addConfirmedTrade, updateConfirmedTrade, userId, isChartReady]);

  // Load Saved User Positions
  useEffect(() => {
    if (!isChartReady || !userId) return;

    const fetchUserPositions = async () => {
      try {
        const data = await positionService.getPositions(userId, activeSymbol);

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
            confidence: 'HIGH',
            createdAt: Math.floor(new Date(pos.created_at || Date.now()).getTime() / 1000),
          });
        });
      } catch (error) {
        console.error('Failed to load saved positions:', error);
      }
    };

    fetchUserPositions();
  }, [isChartReady, userId, activeSymbol, addConfirmedTrade]);

  // Re-render on scroll to keep pinned
  useEffect(() => {
    if (!isChartReady || !chartRef.current) return;
    const timeScale = chartRef.current.timeScale();

    const handleScroll = () => setRenderKey((prev) => prev + 1);
    timeScale.subscribeVisibleLogicalRangeChange(handleScroll);

    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handleScroll);
  }, [isChartReady]);

  // Calculate pixel coords for the overlays
  const calculatePositionOverlay = useCallback(
    (id: string, position: TradePosition) => {
      if (!chartRef.current || !candlestickSeriesRef.current || !chartContainerRef.current) return null;

      const timeScale = chartRef.current.timeScale();
      const series = candlestickSeriesRef.current;

      let logicalIndex = positionLogicalIndexRef.current.get(id);

      if (logicalIndex === undefined) {
        const indexFromTime = timeScale.timeToIndex(position.time);

        if (indexFromTime === null || indexFromTime === -1) {
          const visibleRange = timeScale.getVisibleLogicalRange();
          if (visibleRange) {
            logicalIndex = Math.max(0, Math.floor(visibleRange.to - 40));
          } else {
            logicalIndex = 0;
          }
        } else {
          logicalIndex = indexFromTime;
        }

        positionLogicalIndexRef.current.set(id, logicalIndex);
      }

      let xStart = timeScale.logicalToCoordinate(logicalIndex as Logical);
      if (xStart === null) {
        xStart = 0;
      }

      const yEntry = series.priceToCoordinate(position.entry);
      const yTarget = series.priceToCoordinate(position.target);
      const yStop = series.priceToCoordinate(position.stopLoss);

      if (yEntry === null || yTarget === null || yStop === null) return null;

      const width = boxWidth;
      const x = typeof xStart === 'number' ? xStart : 0;
      const y = Number(Math.min(yEntry, yTarget, yStop));

      const minY = Math.min(yEntry, yTarget, yStop);
      const maxY = Math.max(yEntry, yTarget, yStop);
      const height = maxY - minY;

      const side = position.side || (position.target > position.entry ? 'LONG' : 'SHORT');
      const targetIsAbove = side === 'LONG';
      const finalHeight = Math.max(height, 40);

      return {
        x: Number(x),
        y: Number(y),
        width,
        height: finalHeight,
        yEntry: Number(yEntry),
        yTarget: Number(yTarget),
        yStop: Number(yStop),
        targetIsAbove,
        side,
        logicalIndex,
        entry: Number(position.entry),
        target: Number(position.target),
        stopLoss: Number(position.stopLoss),
      };
    },
    [renderKey, boxWidth]
  );

  // ✅ RESIZE / DRAG HANDLER (FIXED HORIZONTAL MOVEMENT - NO CRASH)
  const handleResizeStart = useCallback((
    e: React.MouseEvent,
    id: string,
    handleType: 'move-entry' | 'target' | 'stop' | 'width',
    currentVal: number,
    anchorVal: number
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const isAi = id === 'active-ai-position';
    const series = candlestickSeriesRef.current;
    const container = chartContainerRef.current;
    if (!series || !activePosition || !container) return;

    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const startWidth = boxWidth;
    const startEntry = activePosition.entry;
    const startTarget = activePosition.target;
    const startStop = activePosition.stopLoss;
    const startTime = activePosition.time;

    const offsetTarget = startTarget - startEntry;
    const offsetStop = startStop - startEntry;

    const timeScale = chartRef.current?.timeScale();

    // Keep track of new logical index for horizontal movement
    let newLogicalIndex: number | null = null;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const deltaX = moveEvent.clientX - startMouseX;
      const deltaY = moveEvent.clientY - startMouseY;

      let newEntry = startEntry;
      let newTarget = startTarget;
      let newStop = startStop;
      let newWidth = startWidth;

      if (handleType === 'move-entry') {
        // 1. Vertical (Price)
        const mouseY = moveEvent.clientY - rect.top;
        const newPrice = series.coordinateToPrice(mouseY);
        if (newPrice === null) return;

        newEntry = Number(newPrice);
        newTarget = newEntry + offsetTarget;
        newStop = newEntry + offsetStop;

        // 2. Horizontal (Logical Index) - store in ref
        if (timeScale) {
          const currentLogical = positionLogicalIndexRef.current.get(id);
          if (currentLogical !== undefined) {
            const visibleRange = timeScale.getVisibleLogicalRange();
            if (visibleRange) {
              const startCoord = timeScale.logicalToCoordinate(visibleRange.from);
              const endCoord = timeScale.logicalToCoordinate(visibleRange.to);
              if (startCoord !== null && endCoord !== null) {
                const avgBarWidth = (endCoord - startCoord) / (visibleRange.to - visibleRange.from);
                if (avgBarWidth > 0) {
                  const barsMoved = Math.round(deltaX / avgBarWidth);
                  newLogicalIndex = currentLogical + barsMoved;
                  // Update the ref immediately so the overlay moves
                  positionLogicalIndexRef.current.set(id, newLogicalIndex);
                }
              }
            }
          }
        }
      }
      else if (handleType === 'target') {
        const mouseY = moveEvent.clientY - rect.top;
        const newPrice = series.coordinateToPrice(mouseY);
        if (newPrice === null) return;
        newTarget = Number(newPrice);
        newEntry = startEntry;
        newStop = startStop;
      }
      else if (handleType === 'stop') {
        const mouseY = moveEvent.clientY - rect.top;
        const newPrice = series.coordinateToPrice(mouseY);
        if (newPrice === null) return;
        newStop = Number(newPrice);
        newEntry = startEntry;
        newTarget = startTarget;
      }
      else if (handleType === 'width') {
        newWidth = Math.max(40, startWidth + deltaX);
        newEntry = startEntry;
        newTarget = startTarget;
        newStop = startStop;
      }

      // Update state (time is not updated during drag to avoid crashes)
      if (handleType === 'width') {
        setBoxWidth(newWidth);
      } else {
        if (isAi) {
          setActivePosition({
            side: activePosition.side,
            entry: newEntry,
            target: newTarget,
            stopLoss: newStop,
            time: startTime, // keep old time until mouse up
          });
        } else {
          updateConfirmedTrade(id, {
            entry: newEntry,
            target: newTarget,
            stopLoss: newStop,
            // time not updated here
          });
        }
      }
      setRenderKey((k) => k + 1);
    };

    const onMouseUp = async () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Now compute the new time from the logical index (if changed)
      let newTime = startTime;
      if (newLogicalIndex !== null && timeScale) {
        // Convert logical index to time via coordinate
        const coord = timeScale.logicalToCoordinate(newLogicalIndex as Logical);
        if (coord !== null) {
          const t = timeScale.coordinateToTime(coord);
          if (t !== null) {
            newTime = t as UTCTimestamp;
          }
        }
        // If conversion fails, fallback to current time
        if (!newTime) {
          newTime = toUnixSeconds(Date.now());
        }
      }

      // Update the store with the final time if we moved horizontally
      if (newLogicalIndex !== null) {
        if (isAi) {
          setActivePosition(prev => prev ? {
            ...prev,
            entry: prev.entry,
            target: prev.target,
            stopLoss: prev.stopLoss,
            time: newTime,
          } : null);
        } else {
          updateConfirmedTrade(id, {
            time: newTime,
          });
        }
      }

      // Save to DB
      if (isAi || !userId) return;

      const existingTrade = confirmedTrades.find((t) => t.id === id);
      if (!existingTrade?.dbId) return;

      const payload = {
        userId,
        symbol: activeSymbol,
        interval: activeInterval,
        side: activePosition.side,
        entry: activePosition.entry,
        target: activePosition.target,
        stopLoss: activePosition.stopLoss,
        time: Math.floor(Date.now() / 1000),
        createdAt: Math.floor(Date.now() / 1000),
      };

      try {
        await positionService.updatePosition(existingTrade.dbId, userId, payload);
      } catch (error) {
        console.error('Failed to save resized position:', error);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [activePosition, boxWidth, setActivePosition, updateConfirmedTrade, confirmedTrades, userId, activeSymbol, activeInterval]);

  // ✅ TRADINGVIEW-STYLE RENDER (RESIZE HANDLES + SCROLL SAFE)
  const renderPositionOverlay = useCallback(() => {
    if (!isChartReady) return null;

    const positionsToRender: { id: string; position: TradePosition }[] = [];

    if (activePosition) {
      positionsToRender.push({
        id: 'active-ai-position',
        position: activePosition,
      });
    }

    confirmedTrades
      .filter((t) => t.symbol === activeSymbol)
      .forEach((trade) => {
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

      const { x, y, width, height, yEntry, yTarget, yStop, targetIsAbove, side, entry, target, stopLoss } = coords;

      const targetAreaHeight = Math.abs(yEntry - yTarget);
      const stopAreaHeight = Math.abs(yEntry - yStop);
      const targetTop = targetIsAbove ? 0 : stopAreaHeight;
      const stopTop = targetIsAbove ? targetAreaHeight : 0;

      const riskDist = Math.abs(entry - stopLoss);
      const rewardDist = Math.abs(target - entry);
      const rrRatio = riskDist > 0 ? (rewardDist / riskDist).toFixed(2) : '0.00';

      return (
        <div
          key={item.id}
          className="absolute pointer-events-auto group z-50 cursor-grab active:cursor-grabbing"
          style={{ left: x, top: y, width, height }}
          // Allow dragging the whole box by clicking on the background
          onMouseDown={(e) => handleResizeStart(e, item.id, 'move-entry', entry, entry)}
        >

          {/* 1. TARGET AREA (GREEN ZONE) */}
          <div
            className="absolute border border-emerald-500/60 bg-emerald-500/20"
            style={{ top: targetTop, height: targetAreaHeight, width: '100%' }}
          >
            <div className="absolute top-1 right-2 text-[10px] text-emerald-400 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
              Target: ${Number(target).toFixed(2)}
            </div>

            {/* HANDLE: Adjust Target Price */}
            <div
              className="absolute -top-2 -right-2 w-3 h-3 bg-white border border-blue-500 cursor-ns-resize rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleResizeStart(e, item.id, 'target', target, entry);
              }}
            />
          </div>

          {/* 2. STOP LOSS AREA (RED ZONE) */}
          <div
            className="absolute border border-rose-500/60 bg-rose-500/20"
            style={{ top: stopTop, height: stopAreaHeight, width: '100%' }}
          >
            <div className="absolute top-1 right-2 text-[10px] text-rose-400 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
              Stop: ${Number(stopLoss).toFixed(2)}
            </div>

            {/* HANDLE: Adjust Stop Loss Price */}
            <div
              className="absolute -bottom-2 -right-2 w-3 h-3 bg-white border border-blue-500 cursor-ns-resize rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleResizeStart(e, item.id, 'stop', stopLoss, entry);
              }}
            />
          </div>

          {/* 3. ENTRY LINE & WIDTH CONTROL */}
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

            {/* ✅ MIDDLE HANDLE: Move Entire Setup (2D) - redundant but kept for compatibility */}
            <div
              className="absolute -top-2 -left-2 w-3 h-3 bg-white border border-blue-500 cursor-move rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleResizeStart(e, item.id, 'move-entry', entry, entry);
              }}
            />

            {/* ✅ RIGHT HANDLE: Increase/Decrease Width Only */}
            <div
              className="absolute -top-2 right-2 w-3 h-3 bg-white border border-blue-500 cursor-ew-resize rounded-sm shadow-md hover:bg-blue-400 hover:scale-125 transition-all"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleResizeStart(e, item.id, 'width', 0, 0);
              }}
            />
          </div>

          {/* 4. CANCEL BUTTON (X) */}
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
  }, [activePosition, confirmedTrades, activeSymbol, calculatePositionOverlay, handleCancelPosition, isChartReady, handleResizeStart]);

  // Setup Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    const initialDark = checkIsDarkMode();

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: initialDark ? '#020617' : '#ffffff' },
        textColor: initialDark ? '#94a3b8' : '#334155',
      },
      grid: {
        vertLines: { color: initialDark ? '#0f172a' : '#f1f5f9' },
        horzLines: { color: initialDark ? '#0f172a' : '#f1f5f9' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#64748b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0f172a' },
        horzLine: { color: '#64748b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0f172a' },
      },
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
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

  const fetchOlderCandles = useCallback(() => {
    if (!socket || !isConnected) return;
    if (isFetchingOlderRef.current || noMoreHistoryRef.current) return;
    if (earliestLoadedTimeRef.current == null) return;

    isFetchingOlderRef.current = true;
    setIsLoadingOlder(true);
    socket.emit('get_older_klines', {
      symbol: activeSymbol,
      interval: activeInterval,
      beforeTime: earliestLoadedTimeRef.current,
    });
  }, [socket, isConnected, activeSymbol, activeInterval]);

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
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
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

    socket.emit('subscribe_symbol', activeSymbol, activeInterval);
    socket.emit('get_klines', { symbol: activeSymbol, interval: activeInterval });

    const handleKlinesHistory = (history: any[]) => {
      if (!candlestickSeriesRef.current) return;
      if (!Array.isArray(history) || history.length === 0) {
        setIsLoading(false);
        setIsEmpty(true);
        return;
      }

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
    };

    const handleKlineUpdate = (candle: any) => {
      if (!candlestickSeriesRef.current || !isHistoryLoadedRef.current) return;
      const candleTime = toUnixSeconds(candle.time ?? candle.timestamp ?? candle.datetime);
      const updated = {
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

    socket.on('klines_history', handleKlinesHistory);
    socket.on('kline_update', handleKlineUpdate);

    return () => {
      socket.emit('unsubscribe_symbol', activeSymbol);
      socket.off('klines_history', handleKlinesHistory);
      socket.off('kline_update', handleKlineUpdate);
    };
  }, [activeSymbol, activeInterval, isConnected, socket]);

  return (
    <div className="relative w-full h-full flex-1 min-h-100 md:min-h-150 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden p-2 flex flex-col">

      {/* ✅ TOOLBAR */}
      <div className="absolute top-3 left-3 z-40 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={() => {
            if (isDrawMode) {
              setIsDrawMode(false);
            } else {
              handleInstantDraw();
            }
          }}
          disabled={isLoading}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors shadow-lg flex items-center gap-1.5 ${
            isDrawMode
              ? 'bg-rose-600 text-white border border-rose-400 animate-pulse'
              : activePosition
              ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          {!activePosition ? 'No AI Setup' : (isDrawMode ? 'Cancel' : 'Draw Setup')}
        </button>

        {isDrawMode && (
          <div className="bg-slate-900/95 border border-slate-700/80 rounded-lg px-3 py-1.5 text-[10px] text-emerald-400 font-mono shadow-xl backdrop-blur-md">
            Setup drawn! Drag the white handles to adjust.
          </div>
        )}
      </div>

      {activePosition && !isDrawMode && (
        <div className="absolute top-3 right-3 z-40 flex items-center gap-2 bg-slate-900/95 border border-slate-700/80 rounded-lg px-3 py-1.5 shadow-xl backdrop-blur-md pointer-events-auto">
          <span className="text-[11px] font-medium text-slate-300">
            Setup: <strong className="text-emerald-400">{activePosition.side}</strong>
          </span>
          <button
            onClick={() => handleCancelPosition('active-ai-position')}
            className="text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/40 rounded px-2 py-0.5 hover:bg-red-500/30 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm text-xs font-mono text-emerald-400">
          Loading {activeSymbol} ({activeInterval})...
        </div>
      )}

      {isEmpty && !isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950 text-slate-400 text-xs font-mono">
          No chart data returned for {activeSymbol}
        </div>
      )}

      {isLoadingOlder && (
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5 bg-slate-900/90 border border-slate-700 rounded-md px-2 py-1 text-[10px] font-mono text-slate-300">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Loading history...
        </div>
      )}

      {/* ✅ CHART AREA */}
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

export default function TradingViewChart() {
  return (
    <ChartErrorBoundary>
      <ChartContent />
    </ChartErrorBoundary>
  );
}