'use client';

import React, { 
  useEffect, 
  useRef, 
  useState, 
  Component, 
  ReactNode, 
  useCallback 
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
} from 'lightweight-charts';
import { useMarketStore, TradePosition } from '../store/useMarketStore';
import { useSocket } from '../providers/SocketProvider';
import { RulerOverlay } from './RulerOverlay';
import { DrawingsOverlay } from './DrawingsOverlay';

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
  return document.documentElement.classList.contains('dark') || 
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

interface ErrorBoundaryProps { children: ReactNode; }
class ChartErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean; error?: Error }> {
  state: any = { hasError: false };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
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
  
  // ✅ FORCE RE-RENDER ON SCROLL TO MAINTAIN PINNING
  const [renderKey, setRenderKey] = useState(0);

  // User drawing state
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [drawStep, setDrawStep] = useState(0); 
  const [userDraft, setUserDraft] = useState<{
    time: UTCTimestamp | null;
    entry: number | null;
    target: number | null;
    stopLoss: number | null;
  }>({ time: null, entry: null, target: null, stopLoss: null });

  const marketStore = useMarketStore();
  const { 
    activeSymbol, 
    activeInterval, 
    activePosition, 
    setActivePosition, 
    aiDrawings,
    confirmedTrades,
    removeConfirmedTrade,
  } = marketStore;

  const extendedStore = marketStore as unknown as { aiSetup?: any };
  const { aiSetup } = extendedStore;

  const { socket, isConnected } = useSocket();

  const handleCancelPosition = useCallback((id: string) => {
    if (id === 'active-ai-position' || id === 'user-drawn-position') {
      setActivePosition(null);
      setIsDrawMode(false);
      setDrawStep(0);
      setUserDraft({ time: null, entry: null, target: null, stopLoss: null });
    } else if (id.startsWith('confirmed-trade-')) {
      const tradeId = id.replace('confirmed-trade-', '');
      if (removeConfirmedTrade) {
        removeConfirmedTrade(tradeId);
      }
    }
  }, [setActivePosition, removeConfirmedTrade]);

  // Sync AI setup to the latest candle
  useEffect(() => {
    if (!aiSetup || !aiSetup.entry || !aiSetup.stopLoss || !aiSetup.target) return;
    if (activePosition) return;

    const entry = Number(aiSetup.entry);
    const stopLoss = Number(aiSetup.stopLoss);
    const target = Number(aiSetup.target);
    const side = (aiSetup.side || (target > entry ? 'LONG' : 'SHORT')).toUpperCase() as 'LONG' | 'SHORT';

    const latestCandleTime = allCandlesRef.current[allCandlesRef.current.length - 1]?.time as UTCTimestamp;
    const startTime = latestCandleTime || toUnixSeconds(Date.now());

    setActivePosition({
      side,
      entry,
      stopLoss,
      target,
      time: startTime,
    } as TradePosition);
  }, [aiSetup, activePosition, setActivePosition]);

  // User Click Handler
  useEffect(() => {
    if (!isChartReady || !chartRef.current || !candlestickSeriesRef.current || !isDrawMode) return;

    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;

    const handleChartClick = (param: MouseEventParams) => {
      if (!param.point || !param.time) return;

      const price = series.coordinateToPrice(param.point.y);
      if (price === null || typeof price !== 'number') return;

      const time = param.time as UTCTimestamp;
      const step = drawStep;

      if (step === 0) {
        setUserDraft(prev => ({ ...prev, time, entry: price }));
        setDrawStep(1);
      } else if (step === 1) {
        setUserDraft(prev => ({ ...prev, target: price }));
        setDrawStep(2);
      } else if (step === 2) {
        const finalDraft = { ...userDraft, stopLoss: price };
        
        const entry = finalDraft.entry!;
        const target = finalDraft.target!;
        const stopLoss = finalDraft.stopLoss!;
        const side = target > entry ? 'LONG' : 'SHORT';
        const time = finalDraft.time!;

        setActivePosition({
          side,
          entry,
          stopLoss,
          target,
          time,
        } as TradePosition);

        setIsDrawMode(false);
        setDrawStep(0);
        setUserDraft({ time: null, entry: null, target: null, stopLoss: null });
      }
    };

    chart.subscribeClick(handleChartClick);
    return () => {
      chart.unsubscribeClick(handleChartClick);
    };
  }, [isChartReady, isDrawMode, drawStep, userDraft, setActivePosition]);

  // ✅ PERFECT PINNING: Re-render on every chart scroll and resize
  useEffect(() => {
    if (!isChartReady || !chartRef.current) return;
    
    const timeScale = chartRef.current.timeScale();

    const handleScroll = () => {
      setRenderKey(prev => prev + 1); // Force recalculation of coordinates
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleScroll);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleScroll);
    };
  }, [isChartReady]);

  // ✅ FIXED: PHYSICAL RENDERING WITH PERFECT GRID PINNING
  const calculatePositionOverlay = useCallback((position: TradePosition) => {
    if (!chartRef.current || !candlestickSeriesRef.current || !chartContainerRef.current) return null;
    
    const timeScale = chartRef.current.timeScale();
    const series = candlestickSeriesRef.current;

    let startTime = toUnixSeconds(position.time || Date.now());
    let xStart = timeScale.timeToCoordinate(startTime);

    // If time isn't found, calculate fallback to the right edge of the chart
    if (xStart === null) {
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (visibleRange) {
        const coordinate = timeScale.logicalToCoordinate(visibleRange.to);
        xStart = coordinate !== null ? coordinate : 0;
      } else {
        xStart = 0;
      }
    }

    const yEntry = series.priceToCoordinate(position.entry);
    const yTarget = series.priceToCoordinate(position.target);
    const yStop = series.priceToCoordinate(position.stopLoss);

    if (yEntry === null || yTarget === null || yStop === null) return null;

    const width = 180;
    const x = typeof xStart === 'number' ? xStart : 0;

    const minY = Math.min(yEntry, yTarget, yStop);
    const maxY = Math.max(yEntry, yTarget, yStop);
    const height = maxY - minY;

    // Ensure side is always defined
    const side = position.side || (position.target > position.entry ? 'LONG' : 'SHORT');
    const targetIsAbove = side === 'LONG';

    const finalHeight = Math.max(height, 40);

    return {
      x,
      y: minY,
      width,
      height: finalHeight,
      yEntry,
      yTarget,
      yStop,
      targetIsAbove,
      side,
      entry: position.entry,
      target: position.target,
      stopLoss: position.stopLoss,
    };
  }, [renderKey]); // ✅ Depend on renderKey to recalculate on every scroll

  // ✅ PHYSICAL RENDERING
  const renderPositionOverlay = useCallback(() => {
    if (!activePosition) return null;
    
    const coords = calculatePositionOverlay(activePosition);
    if (!coords) return null;

    const { x, y, width, height, yEntry, yTarget, yStop, targetIsAbove, side, entry, target, stopLoss } = coords;

    const targetAreaHeight = Math.abs(yEntry - yTarget);
    const stopAreaHeight = Math.abs(yEntry - yStop);

    const targetTop = targetIsAbove ? 0 : stopAreaHeight;
    const stopTop = targetIsAbove ? targetAreaHeight : 0;

    return (
      <div 
        className="absolute pointer-events-auto group z-50"
        style={{ left: x, top: y, width, height }}
      >
        {/* 1. Target Area (Green Box) */}
        <div 
          className="absolute border border-emerald-500/60 bg-emerald-500/20"
          style={{ 
            top: targetTop,
            height: targetAreaHeight,
            width: '100%'
          }}
        >
          <div className="absolute top-1 right-2 text-[10px] text-emerald-400 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
            Target: ${target.toFixed(2)}
          </div>
        </div>

        {/* 2. Stop Loss Area (Red Box) */}
        <div 
          className="absolute border border-rose-500/60 bg-rose-500/20"
          style={{ 
            top: stopTop,
            height: stopAreaHeight,
            width: '100%'
          }}
        >
          <div className="absolute top-1 right-2 text-[10px] text-rose-400 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
            Stop: ${stopLoss.toFixed(2)}
          </div>
        </div>

        {/* 3. Entry Line */}
        <div 
          className="absolute w-full border-t border-slate-400 border-dashed"
          style={{ top: yEntry - y }}
        >
          <div className="absolute -top-3.5 left-2 text-[10px] text-slate-300 font-mono font-bold bg-slate-900/80 px-1.5 py-0.5 rounded backdrop-blur-sm">
            {side} @ ${entry.toFixed(2)}
          </div>
        </div>

        {/* 4. Cancel Button */}
        <button
          onClick={() => handleCancelPosition('active-ai-position')}
          className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-slate-800 border border-slate-600 text-slate-300 hover:bg-red-500 hover:border-red-400 hover:text-white flex items-center justify-center text-[10px] font-bold transition-colors shadow-lg z-10"
        >
          ✕
        </button>
      </div>
    );
  }, [activePosition, calculatePositionOverlay, handleCancelPosition]);

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
      
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-40 flex items-center gap-2">
        <button
          onClick={() => {
            if(isDrawMode) {
              setIsDrawMode(false);
              setDrawStep(0);
              setUserDraft({ time: null, entry: null, target: null, stopLoss: null });
            } else {
              setIsDrawMode(true);
            }
          }}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors shadow-lg ${
            isDrawMode 
              ? 'bg-rose-600 text-white border border-rose-400 animate-pulse' 
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
          }`}
        >
          {isDrawMode ? 'Cancel Draw' : '✏️ Draw Setup'}
        </button>

        {isDrawMode && (
          <div className="bg-slate-900/95 border border-slate-700/80 rounded-lg px-3 py-1.5 text-[10px] text-emerald-400 font-mono shadow-xl backdrop-blur-md">
            {drawStep === 0 && 'Click chart for Entry Price'}
            {drawStep === 1 && 'Click chart for Target Price'}
            {drawStep === 2 && 'Click chart for Stop Loss'}
          </div>
        )}
      </div>

      {/* Top Right Controls */}
      {activePosition && !isDrawMode && (
        <div className="absolute top-3 right-3 z-40 flex items-center gap-2 bg-slate-900/95 border border-slate-700/80 rounded-lg px-3 py-1.5 shadow-xl backdrop-blur-md">
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

      <div ref={chartContainerRef} className="w-full h-full flex-1 relative">
        {/* ✅ The position overlay is pinned and recalculates on scroll */}
        {isChartReady && renderPositionOverlay()}

        {isChartReady && chartRef.current && candlestickSeriesRef.current && (
          <RulerOverlay 
            chartInstance={chartRef.current}
            seriesInstance={candlestickSeriesRef.current}
            containerRef={chartContainerRef}
          />
        )}

        {isChartReady && chartRef.current && candlestickSeriesRef.current && aiDrawings?.length > 0 && (
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