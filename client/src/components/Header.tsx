"use client";

import React, { useState } from "react";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { useSocket } from "../providers/SocketProvider";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];
const POPULAR_SYMBOLS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "EUR/USD",
  "GBP/USD",
];

export default function Header() {
  const { activeSymbol, activeInterval, setActiveSymbol, setActiveInterval } =
    useMarketStore();
  const { user } = useAuthStore();
  const { isConnected } = useSocket();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSymbols = POPULAR_SYMBOLS.filter((s) =>
    s.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Fallback to a deterministic random avatar based on user id/deviceUuid if avatar_url is null
  const avatarSrc =
    user?.avatar_url ||
    `https://api.dicebear.com/7.x/identicon/svg?seed=${user?.id || "default-trader"}`;

  return (
    <header className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-slate-800 dark:text-slate-200 transition-colors duration-200 z-30">
      {/* Left Section: Symbol Selector & Timeframe Buttons */}
      <div className="flex items-center gap-3">
        {/* Symbol Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md font-mono font-bold text-sm bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 transition-all"
          >
            <span>{activeSymbol}</span>
            <svg
              className="w-4 h-4 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl z-50 p-2">
              <input
                type="text"
                placeholder="Search Pair (e.g. BTC/USDT)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 mb-2 font-mono"
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredSymbols.map((sym) => (
                  <button
                    key={sym}
                    onClick={() => {
                      setActiveSymbol(sym);
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                      sym === activeSymbol
                        ? "text-emerald-500 font-bold bg-emerald-500/10"
                        : ""
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

        {/* Timeframe Selectors */}
        <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-900 p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setActiveInterval(tf)}
              className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors ${
                activeInterval === tf
                  ? "bg-emerald-500 text-white font-bold shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Right Section: Network Status & User Profile Badge */}
      <div className="flex items-center gap-4">
        {/* Network Status Indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
          />
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 hidden md:inline">
            {isConnected ? "LIVE FEED" : "CONNECTING"}
          </span>
        </div>

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-800" />

        {/* User Profile Info */}
        {user && (
          <div className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <img
              src={avatarSrc}
              alt={user.name || "Trader"}
              className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 object-cover"
            />
            <span className="text-xs font-mono font-medium text-slate-800 dark:text-slate-200 truncate max-w-[130px]">
              {user.name}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
