'use client';


import { TrendingUp, TrendingDown, Search, Bell } from 'lucide-react';
import { useMarketStore } from '../store/useMarketStore';
import AuthButton from './auth/AlertButton';
import { useRealtimeMarket } from '../hooks/useRealtimeMarket';

const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

export default function DashboardHeader() {
  const { activeSymbol, activeInterval, setActiveInterval, setSearchOpen } = useMarketStore();
  const { latestPrice, priceChangePercent } = useRealtimeMarket(activeSymbol);

  const isPositive = (priceChangePercent ?? 0) >= 0;

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur px-4 flex items-center justify-between gap-4">
      {/* Left: Active Asset Ticker Info */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-300 transition"
          >
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold text-white">{activeSymbol}</span>
            <kbd className="bg-slate-900 px-1.5 py-0.5 rounded text-[10px] text-slate-500 border border-slate-800">
              ⌘K
            </kbd>
          </button>

          <div className="flex items-baseline gap-2">
            <span className="text-xl font-mono font-bold text-slate-100">
              ${latestPrice ? latestPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '---'}
            </span>
            {priceChangePercent !== null && (
              <span
                className={`flex items-center text-xs font-semibold ${
                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {isPositive ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                {isPositive ? '+' : ''}
                {priceChangePercent?.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="hidden md:flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setActiveInterval(tf)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                activeInterval === tf
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Actions & User Auth */}
      <div className="flex items-center gap-3">
        <button className="p-2 text-slate-400 hover:text-slate-200 rounded-lg bg-slate-800/50 border border-slate-700/50 transition">
          <Bell className="w-4 h-4" />
        </button>
        {/* <AuthButton /> */}
      </div>
    </header>
  );
}