'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';

export interface AiDrawing {
  id: string;
  type: 'fib' | 'zone' | 'trendline';
  // For fib: two anchor points (swing high/low). For zone: two price bounds + time range.
  // For trendline: two arbitrary time/price points.
  start: { time: number; price: number };
  end: { time: number; price: number };
  label?: string;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function DrawingsOverlay({
  chartInstance,
  seriesInstance,
  drawings,
}: {
  chartInstance: IChartApi;
  seriesInstance: ISeriesApi<'Candlestick'>;
  drawings: AiDrawing[];
}) {
  const [, forceRender] = useState(0);

  // Re-render on pan/zoom so pixel positions stay correct — same pattern
  // your position overlay already uses in TradingVIewChart.tsx.
  const recalc = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(() => {
    const timeScale = chartInstance.timeScale();
    timeScale.subscribeVisibleTimeRangeChange(recalc);
    timeScale.subscribeVisibleLogicalRangeChange(recalc);
    return () => {
      timeScale.unsubscribeVisibleTimeRangeChange(recalc);
      timeScale.unsubscribeVisibleLogicalRangeChange(recalc);
    };
  }, [chartInstance, recalc]);

  const toCoords = (d: AiDrawing) => {
    const timeScale = chartInstance.timeScale();
    const x1 = timeScale.timeToCoordinate(d.start.time as any);
    const x2 = timeScale.timeToCoordinate(d.end.time as any);
    const y1 = seriesInstance.priceToCoordinate(d.start.price);
    const y2 = seriesInstance.priceToCoordinate(d.end.price);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
    return { x1, x2, y1, y2 };
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      {drawings.map((d) => {
        const c = toCoords(d);
        if (!c) return null;

        if (d.type === 'fib') {
          const top = Math.min(c.y1, c.y2);
          const bottom = Math.max(c.y1, c.y2);
          const range = bottom - top;
          const left = Math.min(c.x1, c.x2);
          const width = Math.abs(c.x2 - c.x1) || 400;

          return (
            <div key={d.id} className="absolute" style={{ left, top, width, height: range }}>
              {FIB_LEVELS.map((level) => {
                // Fib levels measured from the "end" (usually the more recent swing)
                const y = d.end.price > d.start.price
                  ? range - range * level
                  : range * level;
                return (
                  <div
                    key={level}
                    className="absolute left-0 right-0 border-t border-amber-400/60 flex items-center"
                    style={{ top: y }}
                  >
                    <span className="text-[9px] font-mono text-amber-300 bg-slate-900/80 px-1 rounded">
                      {(level * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          );
        }

        if (d.type === 'zone') {
          const top = Math.min(c.y1, c.y2);
          const height = Math.abs(c.y2 - c.y1);
          const left = Math.min(c.x1, c.x2);
          const width = Math.abs(c.x2 - c.x1) || 300;
          return (
            <div
              key={d.id}
              className="absolute bg-purple-500/15 border border-purple-400/50 flex items-start justify-start p-1"
              style={{ left, top, width, height }}
            >
              {d.label && (
                <span className="text-[9px] font-mono text-purple-300 bg-slate-900/80 px-1 rounded">
                  {d.label}
                </span>
              )}
            </div>
          );
        }

        // trendline
        const length = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
        const angle = Math.atan2(c.y2 - c.y1, c.x2 - c.x1) * (180 / Math.PI);
        return (
          <div
            key={d.id}
            className="absolute h-[2px] bg-sky-400 origin-left"
            style={{
              left: c.x1,
              top: c.y1,
              width: length,
              transform: `rotate(${angle}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}