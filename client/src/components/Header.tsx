"use client";

import React, { useState, useEffect, useTransition, useMemo } from "react";
import { Star, ChevronDown, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { useSocket } from "../providers/SocketProvider";
import { marketService, SupportedSymbol } from "../service/marketService";
import { watchlistService } from "../service/watchlistService";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];

const POPULAR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "EURUSD", "GBPUSD", "USDJPY", "XRPUSDT"];

const DEFAULT_FALLBACK_SYMBOLS: SupportedSymbol[] = [
  { id: "1", symbol: "BTCUSDT", name: "Bitcoin / Tether", category: "crypto", exchange: "Binance" },
  { id: "2", symbol: "ETHUSDT", name: "Ethereum / Tether", category: "crypto", exchange: "Binance" },
  { id: "3", symbol: "SOLUSDT", name: "Solana / Tether", category: "crypto", exchange: "Binance" },
  { id: "4", symbol: "XRPUSDT", name: "XRP / Tether", category: "crypto", exchange: "Binance" },
  { id: "5", symbol: "EURUSD", name: "Euro / US Dollar", category: "forex", exchange: "YahooFinance" },
  { id: "6", symbol: "GBPUSD", name: "British Pound / US Dollar", category: "forex", exchange: "YahooFinance" },
  { id: "7", symbol: "USDJPY", name: "US Dollar / Japanese Yen", category: "forex", exchange: "YahooFinance" },
  { id: "8", symbol: "AUDUSD", name: "Australian Dollar / US Dollar", category: "forex", exchange: "YahooFinance" },
  { id: "9", symbol: "USDCAD", name: "US Dollar / Canadian Dollar", category: "forex", exchange: "YahooFinance" },
];

function normalizeWatchlistResponse(raw: any): { symbol: string }[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.watchlist)) return raw.watchlist;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

export default function Header() {
  const { activeSymbol, activeInterval, setActiveSymbol, setActiveInterval } =
    useMarketStore();
  const { user, deviceUuid } = useAuthStore();
  const { isConnected } = useSocket();
  const queryClient = useQueryClient();

  const ownerId = user?.id || deviceUuid;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "crypto" | "forex">("all");
  const [symbols, setSymbols] = useState<SupportedSymbol[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const data: any = await marketService.getSupportedSymbols();
        let extractedSymbols: SupportedSymbol[] = [];

        if (Array.isArray(data)) {
          extractedSymbols = data;
        } else if (data?.symbols && Array.isArray(data.symbols)) {
          extractedSymbols = data.symbols;
        } else if (data?.crypto || data?.forex) {
          extractedSymbols = [...(data.crypto || []), ...(data.forex || [])];
        }

        setSymbols(extractedSymbols.length > 0 ? extractedSymbols : DEFAULT_FALLBACK_SYMBOLS);
      } catch (error) {
        console.error("Failed to fetch supported symbols, using default list:", error);
        setSymbols(DEFAULT_FALLBACK_SYMBOLS);
      } finally {
        setIsLoadingSymbols(false);
      }
    };

    fetchSymbols();
  }, []);

  const { data: watchlistRaw } = useQuery({
    queryKey: ["watchlist", ownerId],
    queryFn: () => watchlistService.getWatchlist(ownerId),
    enabled: !!ownerId,
  });
  const watchlistSymbols = new Set(normalizeWatchlistResponse(watchlistRaw).map((i) => i.symbol));

  const addMutation = useMutation({
    mutationFn: (symbol: string) => watchlistService.addToWatchlist(ownerId, symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist", ownerId] }),
  });
  const removeMutation = useMutation({
    mutationFn: (symbol: string) => watchlistService.removeFromWatchlist(ownerId, symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist", ownerId] }),
  });

  const toggleWatchlist = (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    if (watchlistSymbols.has(symbol)) {
      removeMutation.mutate(symbol);
    } else {
      addMutation.mutate(symbol);
    }
  };

  const filteredSymbols = useMemo(() => {
    return symbols.filter((item) => {
      const itemCategory = (item.category || "").toLowerCase();
      const matchesTab = activeTab === "all" || itemCategory === activeTab;
      const matchesSearch =
        item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesTab && matchesSearch;
    });
  }, [symbols, activeTab, searchQuery]);

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
    <header className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2 sm:px-4 py-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 text-slate-800 dark:text-slate-200 transition-colors duration-200 z-30">
      
      {/* Top / Left Section: Symbol Selector & Timeframe Bar */}
      <div className="flex items-center justify-between sm:justify-start gap-2 max-w-full overflow-hidden">
        {/* Symbol Selector Dropdown Trigger */}
        <div className="relative shrink-0">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-mono font-bold text-xs sm:text-sm bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 transition-all"
          >
            <span className="truncate max-w-[100px] sm:max-w-none">{activeSymbol}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          </button>

          {/* Mobile Overlay Backdrop */}
          {isDropdownOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/20 dark:bg-black/60 sm:bg-transparent backdrop-blur-[1px] sm:backdrop-blur-none"
              onClick={() => setIsDropdownOpen(false)}
            />
          )}

          {/* Dropdown Menu */}
          {isDropdownOpen && (
            <div className="fixed sm:absolute top-16 sm:top-full left-4 sm:left-0 right-4 sm:right-auto mt-1.5 w-[calc(100vw-2rem)] sm:w-[420px] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 p-3 sm:p-3.5">
              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search symbol (e.g. BTC, EUR)..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="w-full pl-8 pr-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>

              {/* Tabs */}
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

              {/* Symbol Items List */}
              <div className="max-h-60 sm:max-h-72 overflow-y-auto space-y-1 pr-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {isLoadingSymbols ? (
                  <div className="text-center py-8 text-xs font-mono text-slate-500 animate-pulse">
                    Loading market symbols...
                  </div>
                ) : sortedSymbols.length === 0 ? (
                  <div className="text-center py-8 text-xs font-mono text-slate-500">No matching symbols found</div>
                ) : (
                  sortedSymbols.map((item) => {
                    const isPopular = POPULAR_SYMBOLS.includes(item.symbol);
                    const isSelected = item.symbol === activeSymbol;
                    const isWatchlisted = watchlistSymbols.has(item.symbol);

                    return (
                      <button
                        key={item.id || item.symbol}
                        onClick={() => {
                          setActiveSymbol(item.symbol);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono rounded-lg transition-colors ${
                          isSelected
                            ? "text-emerald-500 font-bold bg-emerald-500/10 border border-emerald-500/30"
                            : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            onClick={(e) => toggleWatchlist(e, item.symbol)}
                            className="shrink-0 p-0.5 -ml-0.5"
                            title={isWatchlisted ? "Remove from watchlist" : "Add to watchlist"}
                          >
                            <Star
                              className={`w-3.5 h-3.5 transition-colors ${
                                isWatchlisted
                                  ? "text-amber-400 fill-amber-400"
                                  : "text-slate-400 hover:text-amber-400"
                              }`}
                            />
                          </button>
                          <div className="flex flex-col items-start truncate pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs sm:text-sm">{item.symbol}</span>
                              {isPopular && !searchQuery && activeTab === "all" && (
                                <span className="text-[9px] sm:text-[10px] px-1 py-0.2 bg-amber-500/10 text-amber-500 rounded font-normal">
                                  Popular
                                </span>
                              )}
                            </div>
                            {item.name && (
                              <span className="text-[10px] sm:text-[11px] text-slate-400 truncate max-w-[140px] sm:max-w-[220px]">
                                {item.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[9px] sm:text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium shrink-0">
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

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden md:block shrink-0" />

        {/* Scrollable Timeframe Selector */}
        <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-900 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 overflow-x-auto max-w-full [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] shrink">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setActiveInterval(tf)}
              className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-mono font-medium rounded transition-colors shrink-0 ${
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

      {/* Right Section: Status Indicator & Profile */}
      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-900 sm:border-none">
        {/* Connection Status */}
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
          <span className="text-[11px] sm:text-xs font-mono text-slate-500 dark:text-slate-400">
            {isConnected ? "LIVE FEED" : "CONNECTING"}
          </span>
        </div>

        {user && (
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900 px-2.5 py-1 sm:py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <img
              src={avatarSrc}
              alt={user.name || "Trader"}
              className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 object-cover"
            />
            <span className="text-[11px] sm:text-xs font-mono font-medium text-slate-800 dark:text-slate-200 truncate max-w-[90px] sm:max-w-[130px]">
              {user.name}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}