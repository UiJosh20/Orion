"use client";

import React, { useState, useEffect, useTransition, useMemo } from "react";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { useSocket } from "../providers/SocketProvider";
import { marketService, SupportedSymbol } from "../service/marketService";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];

// Curated list of popular symbols matching backend format (no slashes)
const POPULAR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "EURUSD", "GBPUSD", "XRPUSDT"];

export default function Header() {
  const { activeSymbol, activeInterval, setActiveSymbol, setActiveInterval } =
    useMarketStore();
  const { user } = useAuthStore();
  const { isConnected } = useSocket();
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "crypto" | "forex">("all");
  const [symbols, setSymbols] = useState<SupportedSymbol[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(true);
  const [, startTransition] = useTransition();

  // Fetch supported symbols from backend on mount
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const data:any = await marketService.getSupportedSymbols();
        setSymbols(data.symbols);
      } catch (error) {
        console.error("Failed to fetch supported symbols:", error);
      } finally {
        setIsLoadingSymbols(false);
      }
    };

    fetchSymbols();
  }, []);

  // Optimized filtering using useMemo
  const filteredSymbols = useMemo(() => {
    return symbols.filter((item) => {
      const matchesTab =
        activeTab === "all" || item.category?.toLowerCase() === activeTab;
      const matchesSearch =
        item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesTab && matchesSearch;
    });
  }, [symbols, activeTab, searchQuery]);

  // Optimized sorting using useMemo
  const sortedSymbols = useMemo(() => {
    return [...filteredSymbols].sort((a, b) => {
      if (!searchQuery && activeTab === "all") {
        const aPopular = POPULAR_SYMBOLS.includes(a.symbol) ? 0 : 1;
        const bPopular = POPULAR_SYMBOLS.includes(b.symbol) ? 0 : 1;
        return aPopular - bPopular;
      }
      return 0;
    });
  }, [filteredSymbols, searchQuery, activeTab]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    startTransition(() => {
      setSearchQuery(value);
    });
  };

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
            <div className="absolute top-full left-0 mt-1.5 w-[420px] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 p-3.5">
              {/* Search Bar */}
              <input
                type="text"
                placeholder="Search symbol or name (e.g. BTC, EUR)..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 mb-3 font-mono text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              />

              {/* Category Filter Tabs */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg mb-2.5 text-xs font-mono">
                {(["all", "crypto", "forex"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`py-1.5 rounded-md capitalize font-medium transition-all ${
                      activeTab === tab
                        ? "bg-emerald-500 text-white font-bold shadow-sm"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Symbols List */}
              <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {isLoadingSymbols ? (
                  <div className="text-center py-8 text-xs font-mono text-slate-500 animate-pulse">
                    Loading market symbols...
                  </div>
                ) : sortedSymbols.length === 0 ? (
                  <div className="text-center py-8 text-xs font-mono text-slate-500">
                    No matching symbols found
                  </div>
                ) : (
                  sortedSymbols.map((item) => {
                    const isPopular = POPULAR_SYMBOLS.includes(item.symbol);
                    const isSelected = item.symbol === activeSymbol;

                    return (
                      <button
                        key={item.id || item.symbol}
                        onClick={() => {
                          setActiveSymbol(item.symbol);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-mono rounded-lg transition-colors ${
                          isSelected
                            ? "text-emerald-500 font-bold bg-emerald-500/10 border border-emerald-500/30"
                            : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="flex flex-col items-start truncate pr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm">{item.symbol}</span>
                            {isPopular && !searchQuery && activeTab === "all" && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded font-normal">
                                Popular
                              </span>
                            )}
                          </div>
                          {item.name && (
                            <span className="text-[11px] text-slate-400 truncate max-w-[280px]">
                              {item.name}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] uppercase px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
                          {item.category || item.exchange || "Asset"}
                        </span>
                      </button>
                    );
                  })
                )}
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