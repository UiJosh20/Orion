"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Search, Plus, Check, Loader2 } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useMarketStore } from "../store/useMarketStore";
import { marketService, SupportedSymbol } from "../service/marketService";
import { watchlistService } from "../service/watchlistService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const DEFAULT_FALLBACK_SYMBOLS: SupportedSymbol[] = [ /* ... same as before ... */ ];

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
        else if (data?.crypto || data?.forex) extracted = [...(data.crypto || []), ...(data.forex || [])];
        if (!cancelled) setSymbols(extracted.length > 0 ? extracted : DEFAULT_FALLBACK_SYMBOLS);
      } catch { if (!cancelled) setSymbols(DEFAULT_FALLBACK_SYMBOLS); } finally { if (!cancelled) setIsLoadingSymbols(false); }
    })();
    return () => { cancelled = true; };
  }, [isSearchOpen]);

  const { data: watchlistRaw } = useQuery({
    queryKey: ["watchlist", ownerId], queryFn: () => watchlistService.getWatchlist(ownerId), enabled: !!ownerId && isSearchOpen,
  });
  const watchlistSymbols = new Set(normalizeWatchlistResponse(watchlistRaw).map((i) => i.symbol));

  const addMutation = useMutation({
    mutationFn: (symbol: string) => watchlistService.addToWatchlist(ownerId, symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist", ownerId] }),
  });

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return symbols.filter((s) => s.symbol.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q));
  }, [symbols, query]);

  return (
    <Dialog open={isSearchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="border-b border-slate-200 dark:border-slate-800 pb-4">
          <DialogTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">Add to Watchlist</DialogTitle>
        </DialogHeader>
        
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search symbol or name (e.g. BTC, EUR)..." className="pl-8 pr-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 rounded-lg font-mono" />
        </div>

        <ScrollArea className="flex-1 pr-1.5 space-y-1.5 max-h-[300px]">
          {isLoadingSymbols ? (
            <div className="text-center py-8 text-xs font-mono text-slate-500 animate-pulse">Loading symbols...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs font-mono text-slate-500">No matching symbols</div>
          ) : (
            filtered.map((item) => {
              const alreadyAdded = watchlistSymbols.has(item.symbol);
              const isAdding = addMutation.isPending && addMutation.variables === item.symbol;
              return (
                <Button
                  key={item.id || item.symbol}
                  variant="ghost"
                  disabled={alreadyAdded || isAdding}
                  onClick={() => { if (!ownerId) return; addMutation.mutate(item.symbol); setActiveSymbol(item.symbol); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-mono rounded-lg h-auto ${alreadyAdded ? 'opacity-50 cursor-default' : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'}`}
                >
                  <div className="flex flex-col items-start truncate pr-2 text-slate-700 dark:text-slate-300">
                    <span className="font-bold text-sm">{item.symbol}</span>
                    {item.name && <span className="text-[11px] text-slate-400 truncate max-w-[220px]">{item.name}</span>}
                  </div>
                  {alreadyAdded ? <Check className="w-4 h-4 text-emerald-500 shrink-0" /> : isAdding ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" /> : <Plus className="w-4 h-4 text-slate-400 shrink-0" />}
                </Button>
              );
            })
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}