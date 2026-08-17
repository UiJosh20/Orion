"use client";

import React, { useState, useEffect, useTransition, useMemo } from "react";
import { Star, ChevronDown, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { useSocket } from "../providers/SocketProvider";
import { marketService, SupportedSymbol } from "../service/marketService";
import { watchlistService } from "../service/watchlistService";
import AuthButton from "./auth/AuthButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
];

function normalizeWatchlistResponse(raw: any): { symbol: string }[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.watchlist)) return raw.watchlist;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

export default function Header() {
  const { activeSymbol, activeInterval, setActiveSymbol, setActiveInterval } = useMarketStore();
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
        if (Array.isArray(data)) extractedSymbols = data;
        else if (data?.symbols && Array.isArray(data.symbols)) extractedSymbols = data.symbols;
        else if (data?.crypto || data?.forex) extractedSymbols = [...(data.crypto || []), ...(data.forex || [])];
        setSymbols(extractedSymbols.length > 0 ? extractedSymbols : DEFAULT_FALLBACK_SYMBOLS);
      } catch (error) {
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
    if (watchlistSymbols.has(symbol)) removeMutation.mutate(symbol);
    else addMutation.mutate(symbol);
  };

  const filteredSymbols = useMemo(() => {
    return symbols.filter((item) => {
      const itemCategory = (item.category || "").toLowerCase();
      const matchesTab = activeTab === "all" || itemCategory === activeTab;
      const matchesSearch = item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || item.name?.toLowerCase().includes(searchQuery.toLowerCase());
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
    startTransition(() => setSearchQuery(value));
  };

  return (
    <header className="w-full border-b border-zinc-800 bg-black px-2 sm:px-4 py-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 text-zinc-100 z-30">
      <div className="flex items-center justify-between sm:justify-start gap-2 max-w-full overflow-visible">
        <Popover open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <PopoverTrigger>
            <Button
              variant="outline"
              className="flex items-center gap-1.5 px-2.5 py-1.5 h-8 rounded-md font-mono font-bold text-xs sm:text-sm bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300"
            >
              <span className="truncate max-w-[100px] sm:max-w-none">{activeSymbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0 bg-zinc-950 border-zinc-800" align="start">
            <div className="p-3 border-b border-zinc-800">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="text"
                  placeholder="Search symbol (e.g. BTC, EUR)..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="pl-8 pr-3.5 py-1.5 text-xs bg-zinc-900 border-zinc-800 rounded-lg font-mono text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-zinc-700"
                />
              </div>
            </div>

            <div className="p-2 border-b border-zinc-800">
              <div className="grid grid-cols-3 gap-1 bg-zinc-900 rounded-lg p-1">
                {(["all", "crypto", "forex"] as const).map((tab) => (
                  <Button
                    key={tab}
                    variant={activeTab === tab ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab(tab)}
                    className={`text-xs font-mono h-7 ${
                      activeTab === tab
                        ? "bg-white text-black hover:bg-zinc-200"
                        : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                    }`}
                  >
                    {tab}
                  </Button>
                ))}
              </div>
            </div>

            <div className="max-h-60 sm:max-h-72 overflow-y-auto p-1 space-y-1 bg-zinc-950">
              {isLoadingSymbols ? (
                <div className="text-center py-8 text-xs font-mono text-zinc-500 animate-pulse">Loading market symbols...</div>
              ) : sortedSymbols.length === 0 ? (
                <div className="text-center py-8 text-xs font-mono text-zinc-500">No matching symbols found</div>
              ) : (
                sortedSymbols.map((item) => {
                  const isPopular = POPULAR_SYMBOLS.includes(item.symbol);
                  const isSelected = item.symbol === activeSymbol;
                  const isWatchlisted = watchlistSymbols.has(item.symbol);

                  return (
                    <div
                      key={item.id || item.symbol}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setActiveSymbol(item.symbol); setIsDropdownOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono rounded-lg transition-colors cursor-pointer ${
                        isSelected
                          ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/30"
                          : "text-zinc-300 hover:bg-zinc-900"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Button variant="ghost" size="icon" className="h-5 w-5 p-0 shrink-0" onClick={(e) => toggleWatchlist(e, item.symbol)}>
                          <Star className={`w-3.5 h-3.5 ${isWatchlisted ? 'text-amber-400 fill-amber-400' : 'text-zinc-500'}`} />
                        </Button>
                        <div className="flex flex-col items-start truncate pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs sm:text-sm">{item.symbol}</span>
                            {isPopular && !searchQuery && activeTab === "all" && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-amber-500/10 text-amber-500">Popular</Badge>
                            )}
                          </div>
                          {item.name && <span className="text-[10px] text-zinc-500 truncate max-w-[140px]">{item.name}</span>}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 uppercase bg-zinc-900 text-zinc-500 border-zinc-800">
                        {item.category || item.exchange || "Asset"}
                      </Badge>
                    </div>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="h-5 w-px bg-zinc-800 hidden md:block shrink-0" />

        <Select value={activeInterval} onValueChange={(value: string | null) => setActiveInterval(value ?? '1h')}>
          <SelectTrigger className="w-[140px] h-7 text-xs font-mono bg-zinc-900 border-zinc-800 text-zinc-300">
            <SelectValue placeholder="1h" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-300">
            {TIMEFRAMES.map((tf) => (
              <SelectItem key={tf} value={tf} className="text-xs font-mono focus:bg-zinc-800">
                {tf}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-zinc-800">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`h-2 w-2 rounded-full p-0 ${isConnected ? 'bg-emerald-500 border-emerald-500 animate-pulse' : 'bg-amber-500 border-amber-500'}`} />
          <span className="text-[11px] font-mono text-zinc-500">{isConnected ? "LIVE FEED" : "CONNECTING"}</span>
        </div>
        <div className="h-5 w-px bg-zinc-800 hidden sm:block shrink-0" />
        <AuthButton />
      </div>
    </header>
  );
}