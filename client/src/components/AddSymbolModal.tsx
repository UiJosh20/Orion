"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Search, Plus, Check, Loader2 } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useMarketStore } from "../store/useMarketStore";
import { marketService, SupportedSymbol } from "../service/marketService";
import { watchlistService } from "../service/watchlistService";

const DEFAULT_FALLBACK_SYMBOLS: SupportedSymbol[] = [
  {
    id: "1",
    symbol: "BTCUSDT",
    name: "Bitcoin / Tether",
    category: "crypto",
    exchange: "Binance",
  },
  {
    id: "2",
    symbol: "ETHUSDT",
    name: "Ethereum / Tether",
    category: "crypto",
    exchange: "Binance",
  },
  {
    id: "3",
    symbol: "SOLUSDT",
    name: "Solana / Tether",
    category: "crypto",
    exchange: "Binance",
  },
  {
    id: "4",
    symbol: "XRPUSDT",
    name: "XRP / Tether",
    category: "crypto",
    exchange: "Binance",
  },
  {
    id: "5",
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    category: "forex",
    exchange: "YahooFinance",
  },
  {
    id: "6",
    symbol: "GBPUSD",
    name: "British Pound / US Dollar",
    category: "forex",
    exchange: "YahooFinance",
  },
  {
    id: "7",
    symbol: "USDJPY",
    name: "US Dollar / Japanese Yen",
    category: "forex",
    exchange: "YahooFinance",
  },
];

function normalizeWatchlistResponse(raw: any): { symbol: string }[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.watchlist)) return raw.watchlist;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

export default function AddSymbolModal() {
  const { isSearchOpen, setSearchOpen, setActiveSymbol } = useMarketStore();
  const { user, deviceUuid } = useAuthStore();
  const queryClient = useQueryClient();
  const ownerId = user?.id || deviceUuid;

  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<SupportedSymbol[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(true);

  // Close modal on Escape keypress
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    if (isSearchOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen, setSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen) return;
    let cancelled = false;
    (async () => {
      setIsLoadingSymbols(true);
      try {
        const data: any = await marketService.getSupportedSymbols();
        let extracted: SupportedSymbol[] = [];
        if (Array.isArray(data)) extracted = data;
        else if (Array.isArray(data?.symbols)) extracted = data.symbols;
        else if (data?.crypto || data?.forex)
          extracted = [...(data.crypto || []), ...(data.forex || [])];
        if (!cancelled)
          setSymbols(
            extracted.length > 0 ? extracted : DEFAULT_FALLBACK_SYMBOLS,
          );
      } catch {
        if (!cancelled) setSymbols(DEFAULT_FALLBACK_SYMBOLS);
      } finally {
        if (!cancelled) setIsLoadingSymbols(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSearchOpen]);

  const { data: watchlistRaw } = useQuery({
    queryKey: ["watchlist", ownerId],
    queryFn: () => watchlistService.getWatchlist(ownerId),
    enabled: !!ownerId && isSearchOpen,
  });

  const watchlistSymbols = new Set(
    normalizeWatchlistResponse(watchlistRaw).map((i) => i.symbol),
  );

  const addMutation = useMutation({
    mutationFn: (symbol: string) =>
      watchlistService.addToWatchlist(ownerId, symbol),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", ownerId] });
    },
  });

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return symbols.filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q),
    );
  }, [symbols, query]);

  if (!isSearchOpen) return null;

  return (
    <div
      onClick={() => setSearchOpen(false)}
      className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 pt-16 sm:pt-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
            Add to Watchlist
          </span>
          <button
            onClick={() => setSearchOpen(false)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol or name (e.g. BTC, EUR)..."
              className="w-full pl-8 pr-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1.5 space-y-1.5 [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.700/50%)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
          {isLoadingSymbols ? (
            <div className="text-center py-8 text-xs font-mono text-slate-500 animate-pulse">
              Loading symbols...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs font-mono text-slate-500">
              No matching symbols
            </div>
          ) : (
            filtered.map((item) => {
              const alreadyAdded = watchlistSymbols.has(item.symbol);
              const isAdding =
                addMutation.isPending && addMutation.variables === item.symbol;

              return (
                <button
                  key={item.id || item.symbol}
                  disabled={alreadyAdded || isAdding}
                  onClick={() => {
                    if (!ownerId) return;
                    addMutation.mutate(item.symbol);
                    setActiveSymbol(item.symbol);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-mono rounded-lg transition-colors ${
                    alreadyAdded
                      ? "opacity-50 cursor-default"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <div className="flex flex-col items-start truncate pr-2 text-slate-700 dark:text-slate-300">
                    <span className="font-bold text-sm">{item.symbol}</span>
                    {item.name && (
                      <span className="text-[11px] text-slate-400 truncate max-w-[220px]">
                        {item.name}
                      </span>
                    )}
                  </div>
                  {alreadyAdded ? (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : isAdding ? (
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
                  ) : (
                    <Plus className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
