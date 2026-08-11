'use client';

import React, { useEffect, useRef, useState, Component, ErrorInfo, ReactNode } from 'react';
import { 
  createChart, 
  ColorType, 
  IChartApi, 
  ISeriesApi, 
  CandlestickData,
  CandlestickSeries,
  UTCTimestamp
} from 'lightweight-charts';
import { useMarketStore } from '../store/useMarketStore';
import { useSocket } from '../providers/SocketProvider';

// Standardize Timestamps
function toUnixSeconds(time: any): UTCTimestamp {
  if (typeof time === 'number') {
    return (time > 1e10 ? Math.floor(time / 1000) : Math.floor(time)) as UTCTimestamp;
  }
  if (typeof time === 'string') {
    const parsed = new Date(time).getTime();
    if (!isNaN(parsed)) {
      return Math.floor(parsed / 1000) as UTCTimestamp;
    }
  }
  if (time instanceof Date) {
    return Math.floor(time.getTime() / 1000) as UTCTimestamp;
  }
  return Math.floor(Date.now() / 1000) as UTCTimestamp;
}

// Helper to determine if system/app is in Dark Mode
function checkIsDarkMode(): boolean {
  if (typeof window === 'undefined') return true;
  
  // 1. Check if Next.js/Tailwind document class has 'dark'
  const hasDarkClass = document.documentElement.classList.contains('dark');
  
  // 2. Fallback to Device/System OS level theme preference
  const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  return hasDarkClass || systemPrefersDark;
}

// Error Boundary
interface ErrorBoundaryProps { children: ReactNode; }
interface ErrorBoundaryState { hasError: boolean; error?: Error; }

class ChartErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
          <p className="text-red-500 font-medium text-sm mb-2">Failed to render chart</p>
          <p className="text-slate-500 text-xs font-mono mb-4">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg"
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

  const lastTimeRef = useRef<number | null>(null);
  const isHistoryLoadedRef = useRef<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);

  const { activeSymbol, activeInterval } = useMarketStore();
  const { socket, isConnected } = useSocket();

  // Initialize Canvas & Add System Media Query + Mutation Observers for Themeing
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;

    const applyTheme = (isDark: boolean) => {
      if (!chartRef.current) return;
      chartRef.current.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: isDark ? '#020617' : '#ffffff' },
          textColor: isDark ? '#94a3b8' : '#334155',
        },
        grid: {
          vertLines: { color: isDark ? '#0f172a' : '#f1f5f9' },
          horzLines: { color: isDark ? '#0f172a' : '#f1f5f9' },
        },
      });
    };

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
      width: container.clientWidth || 600,
      height: container.clientHeight || 450,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
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

    // 1. Listen for device OS preference changes (System Theme Switch)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      applyTheme(e.matches || document.documentElement.classList.contains('dark'));
    };
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    // 2. Listen for HTML class changes (App Theme Switcher)
    const observer = new MutationObserver(() => {
      applyTheme(checkIsDarkMode());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Handle Resize
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);

    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
      observer.disconnect();
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      lastTimeRef.current = null;
      isHistoryLoadedRef.current = false;
    };
  }, []);

  // Fetch Historical Snapshot & Stream Live Updates
  useEffect(() => {
    if (!isConnected || !socket) return;

    setIsLoading(true);
    setHasError(false);
    setIsEmpty(false);
    isHistoryLoadedRef.current = false;
    lastTimeRef.current = null;

    socket.emit('subscribe_symbol', activeSymbol, activeInterval);
    socket.emit('get_klines', { symbol: activeSymbol, interval: activeInterval });

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

        const deduplicated: CandlestickData[] = [];
        for (const item of rawFormatted) {
          if (
            deduplicated.length === 0 || 
            (item.time as number) > (deduplicated[deduplicated.length - 1].time as number)
          ) {
            deduplicated.push(item);
          }
        }

        if (deduplicated.length === 0) {
          setIsEmpty(true);
        } else {
          candlestickSeriesRef.current.setData(deduplicated);
          lastTimeRef.current = deduplicated[deduplicated.length - 1].time as number;
          isHistoryLoadedRef.current = true;
          chartRef.current?.timeScale().fitContent();
        }

        setIsLoading(false);
      } catch (err: any) {
        console.error('[Chart History Load Error]:', err);
        setHasError(true);
        setIsLoading(false);
      }
    };

    const handleKlineUpdate = (candle: any) => {
      if (!candlestickSeriesRef.current || !isHistoryLoadedRef.current) return;

      try {
        const candleTime = toUnixSeconds(candle.time ?? candle.timestamp ?? candle.datetime);
        if (lastTimeRef.current !== null && candleTime < lastTimeRef.current) return;

        const formattedCandle: CandlestickData = {
          time: candleTime,
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
        };

        candlestickSeriesRef.current.update(formattedCandle);
        lastTimeRef.current = candleTime;
      } catch (err) {
        console.error('[Chart Realtime Update Error]:', err);
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
    <div className="relative w-full h-full min-h-[450px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden p-2 flex flex-col transition-colors duration-200">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm text-slate-600 dark:text-slate-400 text-xs font-mono space-y-2">
          <div className="w-5 h-5 border-2 border-slate-400 dark:border-slate-600 border-t-emerald-500 rounded-full animate-spin" />
          <span>Loading {activeInterval} chart data...</span>
        </div>
      )}

      {isEmpty && !isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white dark:bg-slate-950 text-slate-500 text-xs font-mono">
          No history available for {activeSymbol} ({activeInterval})
        </div>
      )}

      <div ref={chartContainerRef} className="w-full h-full flex-1" />
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