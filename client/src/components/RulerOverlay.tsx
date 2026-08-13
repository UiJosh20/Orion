'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { IChartApi, ISeriesApi, MouseEventParams, CandlestickData } from 'lightweight-charts';

interface RulerState {
  active: boolean;
  startX: number;
  startY: number;
  startPrice: number;
  startLogical: number;
  currentX: number;
  currentY: number;
  currentPrice: number;
  currentLogical: number;
  snapMode: boolean; // true while Shift is held during the drag
}

function getSnappedOHLC(
  candle: CandlestickData, 
  mousePrice: number, 
  seriesInstance: ISeriesApi<'Candlestick'>
): { price: number; y: number } | null {
  const levels = [candle.high, candle.low, candle.open, candle.close];
  const closestPrice = levels.reduce((prev, curr) => 
    Math.abs(curr - mousePrice) < Math.abs(prev - mousePrice) ? curr : prev
  );
  const y = seriesInstance.priceToCoordinate(closestPrice);
  if (y === null) return null;
  return { price: closestPrice, y };
}

export function RulerOverlay({
  chartInstance,
  seriesInstance,
  containerRef,
}: {
  chartInstance: IChartApi;
  seriesInstance: ISeriesApi<'Candlestick'>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [ruler, setRuler] = useState<RulerState | null>(null);

  // Continuous crosshair tracking while dragging.
  // snapMode = true -> snap X to bar center and Y to nearest OHLC level (old behavior).
  // snapMode = false -> raw pixel/price tracking, like TradingView's default ruler.
  useEffect(() => {
    if (!chartInstance || !seriesInstance) return;

    const handleCrosshairMove = (param: MouseEventParams) => {
      setRuler((prev) => {
        if (!prev || !prev.active || !param.point) return prev;

        const timeScale:any = chartInstance.timeScale();
        let currentX :any= param.point.x;
        let currentY :any= param.point.y;
        let currentPrice = seriesInstance.coordinateToPrice(param.point.y) ?? prev.currentPrice;
        let currentLogical = param.logical !== undefined ? Math.round(param.logical) : prev.currentLogical;

        if (prev.snapMode) {
          const candle = param.seriesData.get(seriesInstance) as CandlestickData | undefined;
          if (candle && param.logical !== undefined) {
            const snappedX = timeScale.logicalToCoordinate(currentLogical);
            if (snappedX !== null) currentX = snappedX;

            const mousePrice = seriesInstance.coordinateToPrice(param.point.y);
            if (mousePrice !== null) {
              const snapped = getSnappedOHLC(candle, mousePrice, seriesInstance);
              if (snapped) {
                currentY = snapped.y;
                currentPrice = snapped.price;
              }
            }
          }
        }

        return { ...prev, currentX, currentY, currentPrice, currentLogical };
      });
    };

    chartInstance.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chartInstance.unsubscribeCrosshairMove(handleCrosshairMove);
    };
  }, [chartInstance, seriesInstance]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!chartInstance || !seriesInstance || !containerRef.current) return;

    if (!e.shiftKey && !e.altKey) {
      // Plain click clears any locked measurement
      setRuler(null);
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const timeScale:any = chartInstance.timeScale();
    const logical = timeScale.coordinateToLogical(x);
    const mousePrice = seriesInstance.coordinateToPrice(y);
    if (mousePrice === null) return;

    // Shift = snap-to-OHLC ruler, Alt = free pixel ruler
    const snapMode = e.shiftKey;

    let startX :any= x;
    let startY :any= y;
    let startPrice :any= mousePrice;
    let startLogical = logical !== null ? Math.round(logical) : 0;

    if (snapMode && logical !== null) {
      const roundedLogical = Math.round(logical);
      const snappedX = timeScale.logicalToCoordinate(roundedLogical);
      const data = seriesInstance.data();
      const candle = data[roundedLogical] as CandlestickData | undefined;

      if (snappedX !== null) startX = snappedX;
      if (candle) {
        const snapped = getSnappedOHLC(candle, mousePrice, seriesInstance);
        if (snapped) {
          startY = snapped.y;
          startPrice = snapped.price;
        }
      }
    }

    setRuler({
      active: true,
      startX,
      startY,
      startPrice,
      startLogical,
      currentX: startX,
      currentY: startY,
      currentPrice: startPrice,
      currentLogical: startLogical,
      snapMode,
    });
  }, [chartInstance, seriesInstance, containerRef]);

  const handleMouseUp = useCallback(() => {
    setRuler((prev) => (prev && prev.active ? { ...prev, active: false } : prev));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [containerRef, handleMouseDown, handleMouseUp]);

  if (!ruler) return null;

  const priceDelta = ruler.currentPrice - ruler.startPrice;
  const percentChange = ruler.startPrice !== 0 ? ((priceDelta / ruler.startPrice) * 100).toFixed(2) : '0.00';
  const barCount = Math.abs(ruler.currentLogical - ruler.startLogical) + 1;
  const isPositive = priceDelta >= 0;

  const left = Math.min(ruler.startX, ruler.currentX);
  const top = Math.min(ruler.startY, ruler.currentY);
  const width = Math.abs(ruler.currentX - ruler.startX);
  const height = Math.abs(ruler.currentY - ruler.startY);

  return (
    <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      <div
        className={`absolute border border-dashed transition-none ${
          isPositive ? 'bg-blue-500/15 border-blue-400' : 'bg-rose-500/15 border-rose-400'
        }`}
        style={{ left, top, width: Math.max(width, 2), height: Math.max(height, 2) }}
      >
        <div
          className={`absolute ${
            isPositive ? 'bg-blue-600' : 'bg-rose-600'
          } text-white font-mono text-[10px] p-2 rounded-lg shadow-2xl flex flex-col gap-0.5 whitespace-nowrap`}
          style={{
            left: width / 2 - 50,
            top: ruler.currentY < ruler.startY ? -50 : height + 10,
          }}
        >
          <span className="font-bold">
            {isPositive ? '+' : ''}{priceDelta.toFixed(2)} ({isPositive ? '+' : ''}{percentChange}%)
          </span>
          <span className="text-slate-200 text-[9px]">
            {barCount} {barCount === 1 ? 'bar' : 'bars'}
          </span>
        </div>
      </div>
    </div>
  );
}