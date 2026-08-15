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
} from 'lightweight-charts';
import { useMarketStore, TradePosition } from '../store/useMarketStore';
import { useSocket } from '../providers/SocketProvider';
import { RectanglePlugin } from '../plugins/RectanglePlugin';
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

  const activePrimitivesRef = useRef<RectanglePlugin[]>([]);
  const isHistoryLoadedRef = useRef<boolean>(false);
  const allCandlesRef = useRef<CandlestickData[]>([]);
  const earliestLoadedTimeRef = useRef<number | null>(null);
  const isFetchingOlderRef = useRef<boolean>(false);
  const noMoreHistoryRef = useRef<boolean>(false);

  const [isChartReady, setIsChartReady] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);

  const marketStore = useMarketStore();
  const { 
    activeSymbol, 
    activeInterval, 
    activePosition, 
    setActivePosition, 
    aiDrawings,
    confirmedTrades,
  } = marketStore;

  const extendedStore = marketStore as unknown as { 
    aiSetup?: any; 
    confidence?: string;
    riskPercent?: number;
    riskRewardRatio?: number;
  };
  const { aiSetup, confidence, riskPercent = 2, riskRewardRatio = 2 } = extendedStore;

  const { socket, isConnected } = useSocket();

  const clearPrimitives = useCallback(() => {
    if (!candlestickSeriesRef.current) return;
    activePrimitivesRef.current.forEach((plugin) => {
      try {
        candlestickSeriesRef.current?.detachPrimitive(plugin);
      } catch (e) {
        // Ignored
      }
    });
    activePrimitivesRef.current = [];
  }, []);

  // Dynamic Risk Sync based on Current Chart Candle Price
  useEffect(() => {
    if (!allCandlesRef.current.length) return;

    const latestCandle = allCandlesRef.current[allCandlesRef.current.length - 1];
    const currentPrice = latestCandle.close;

    // Use setup entry if close to live price, otherwise anchor to current live price
    let entryPrice = aiSetup?.entry ? Number(aiSetup.entry) : currentPrice;
    if (Math.abs(entryPrice - currentPrice) / currentPrice > 0.05) {
      entryPrice = currentPrice;
    }

    const isShort = (aiSetup?.side || 'SHORT').toUpperCase() === 'SHORT';
    const riskDelta = entryPrice * (riskPercent / 100);

    const stopLoss = isShort ? entryPrice + riskDelta : entryPrice - riskDelta;
    const target = isShort ? entryPrice - (riskDelta * riskRewardRatio) : entryPrice + (riskDelta * riskRewardRatio);

    const startTime = latestCandle.time as UTCTimestamp;

    if (!activePosition || activePosition.entry !== entryPrice) {
      setActivePosition({
        side: isShort ? 'SHORT' : 'LONG',
        entry: Number(entryPrice.toFixed(2)),
        stopLoss: Number(stopLoss.toFixed(2)),
        target: Number(target.toFixed(2)),
        time: startTime,
      } as TradePosition);
    }
  }, [aiSetup, confidence, riskPercent, riskRewardRatio, activePosition, setActivePosition]);

  const renderCanvasPrimitives = useCallback(() => {
    const series = candlestickSeriesRef.current;
    if (!series || !allCandlesRef.current.length) return;

    clearPrimitives();

    const latestCandleTime = (allCandlesRef.current[allCandlesRef.current.length - 1]?.time ?? toUnixSeconds(Date.now())) as UTCTimestamp;

    if (activePosition) {
      const startTime = (activePosition.time ? toUnixSeconds(activePosition.time) : latestCandleTime) as UTCTimestamp;
      const endTime = (startTime + 3600 * 12) as UTCTimestamp; // Extend box 12h into future

      // Target Rectangle (Green)
      const targetBox = new RectanglePlugin({
        id: 'active-target',
        p1: { time: startTime, price: activePosition.entry },
        p2: { time: endTime, price: activePosition.target },
        fillColor: 'rgba(16, 185, 129, 0.18)',
        borderColor: '#10b981',
        borderWidth: 1,
        label: `Target: ${activePosition.target}`,
        extendRight: true,
      });

      // Stop Loss Rectangle (Red)
      const stopBox = new RectanglePlugin({
        id: 'active-stop',
        p1: { time: startTime, price: activePosition.entry },
        p2: { time: endTime, price: activePosition.stopLoss },
        fillColor: 'rgba(239, 68, 68, 0.18)',
        borderColor: '#ef4444',
        borderWidth: 1,
        label: `Stop: ${activePosition.stopLoss}`,
        extendRight: true,
      });

      series.attachPrimitive(targetBox);
      series.attachPrimitive(stopBox);
      activePrimitivesRef.current.push(targetBox, stopBox);
    }
  }, [activePosition, clearPrimitives]);

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
      clearPrimitives();
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      setIsChartReady(false);
    };
  }, [clearPrimitives]);

  useEffect(() => {
    if (isChartReady) {
      renderCanvasPrimitives();
    }
  }, [isChartReady, activePosition, confirmedTrades, renderCanvasPrimitives]);

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
      renderCanvasPrimitives();
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
  }, [activeSymbol, activeInterval, isConnected, socket, renderCanvasPrimitives]);

  return (
    <div className="relative w-full h-full flex-1 min-h-100 md:min-h-150 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden p-2 flex flex-col">
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

      <div ref={chartContainerRef} className="w-full h-full flex-1 relative cursor-crosshair">
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