'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { IChartApi, ISeriesApi, MouseEventParams } from 'lightweight-charts';

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

  // Always tracks the raw pixel/price under the cursor — no snapping to
  // candle OHLC levels at any point.
  useEffect(() => {
    if (!chartInstance || !seriesInstance) return;

    const handleCrosshairMove = (param: MouseEventParams) => {
      setRuler((prev) => {
        if (!prev || !prev.active || !param.point) return prev;

        const currentPrice = seriesInstance.coordinateToPrice(param.point.y) ?? prev.currentPrice;
        const currentLogical = param.logical !== undefined ? param.logical : prev.currentLogical;

        return {
          ...prev,
          currentX: param.point.x,
          currentY: param.point.y,
          currentPrice,
          currentLogical,
        };
      });
    };

    chartInstance.subscribeCrosshairMove(handleCrosshairMove);
    return () => chartInstance.unsubscribeCrosshairMove(handleCrosshairMove);
  }, [chartInstance, seriesInstance]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!chartInstance || !seriesInstance || !containerRef.current) return;

    if (!e.shiftKey) {
      setRuler(null);
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const timeScale = chartInstance.timeScale();
    const logical = timeScale.coordinateToLogical(x);
    const mousePrice = seriesInstance.coordinateToPrice(y);
    if (mousePrice === null) return;

    setRuler({
      active: true,
      startX: x,
      startY: y,
      startPrice: mousePrice,
      startLogical: logical !== null ? logical : 0,
      currentX: x,
      currentY: y,
      currentPrice: mousePrice,
      currentLogical: logical !== null ? logical : 0,
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
  const barCount = Math.round(Math.abs(ruler.currentLogical - ruler.startLogical)) + 1;
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