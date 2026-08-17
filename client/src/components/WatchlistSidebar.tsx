'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, Trash2, TrendingUp, TrendingDown, Plus, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useMarketStore } from '../store/useMarketStore';
import { watchlistService } from '../service/watchlistService';
import AddSymbolModal from './AddSymbolModal';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WatchlistItem {
  symbol: string;
  name?: string;
  price?: number;
  change24h?: number;
}

function normalizeWatchlistResponse(raw: any): WatchlistItem[] {
  if (!raw) return [];
  const findArray = (obj: any, depth = 0): any[] | null => {
    if (!obj || depth > 3) return null;
    if (Array.isArray(obj)) return obj;
    if (typeof obj === 'object') {
      const priorityKeys = ['watchlist', 'data', 'items', 'symbols', 'result', 'payload', 'list'];
      for (const key of priorityKeys) { if (Array.isArray(obj[key])) return obj[key]; }
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          const found = findArray(obj[key], depth + 1);
          if (found) return found;
        }
      }
    }
    return null;
  };
  const extractedArray = findArray(raw) || [];
  return extractedArray.map((item) => {
    if (typeof item === 'string') return { symbol: item };
    if (typeof item === 'object' && item !== null) {
      return {
        symbol: item.symbol || item.ticker || item.asset || item.id || '',
        name: item.name || item.title || item.symbol,
        price: item.price ?? item.current_price ?? item.lastPrice,
        change24h: item.change24h ?? item.price_change_percentage_24h ?? item.change,
      };
    }
    return null;
  }).filter((item): item is WatchlistItem => Boolean(item && item.symbol));
}

export default function WatchlistSidebar() {
  const queryClient = useQueryClient();
  const { user, deviceUuid } = useAuthStore();
  const { activeSymbol, setActiveSymbol, setSearchOpen } = useMarketStore();
  const ownerId = user?.id || deviceUuid;

  const { data: watchlist = [], isLoading, isError } = useQuery({
    queryKey: ['watchlist', ownerId],
    queryFn: async () => normalizeWatchlistResponse(await watchlistService.getWatchlist(ownerId)),
    enabled: !!ownerId,
  });
  const safeWatchlist: WatchlistItem[] = Array.isArray(watchlist) ? watchlist : [];

  const removeMutation = useMutation({
    mutationFn: (symbolToRemove: string) => watchlistService.removeFromWatchlist(ownerId, symbolToRemove),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist', ownerId] }),
  });

  return (
    <Card className="bg-zinc-950/60 border-zinc-800 rounded-xl shadow-none h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-2">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          <CardTitle className="text-sm font-semibold text-zinc-200">Watchlist</CardTitle>
          <Badge variant="outline" className="text-xs bg-zinc-900 px-2 py-0.5 rounded-full text-zinc-400 font-mono border-zinc-800">
            {safeWatchlist.length}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={() => setSearchOpen(true)}>
          <Plus className="w-4 h-4" />
        </Button>
      </CardHeader>

      <CardContent className="flex-1 p-0 pl-3 pr-3 pb-3 overflow-hidden">
        <ScrollArea className="h-full pr-2">
          <div className="space-y-1.5">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-zinc-500 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Loading watchlist...</span>
              </div>
            ) : isError ? (
              <div className="text-center py-8 px-2 border border-dashed border-rose-900/60 rounded-lg">
                <p className="text-xs text-rose-400 font-medium">Couldn't load watchlist</p>
                <p className="text-[11px] text-zinc-500 mt-1">Try refreshing the page.</p>
              </div>
            ) : safeWatchlist.length === 0 ? (
              <div className="text-center py-8 px-2 border border-dashed border-zinc-800 rounded-lg">
                <p className="text-xs text-zinc-400 font-medium">No assets saved</p>
                <p className="text-[11px] text-zinc-500 mt-1">Search and click the star icon to track symbols.</p>
                <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)} className="mt-3 text-xs bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800">
                  Add Symbols
                </Button>
              </div>
            ) : (
              safeWatchlist.map((item) => {
                const isActive = activeSymbol === item.symbol;
                const isPositive = (item.change24h ?? 0) >= 0;
                return (
                  <div
                    key={item.symbol}
                    onClick={() => setActiveSymbol(item.symbol)}
                    className={`group flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition ${
                      isActive
                        ? 'bg-blue-950/40 border-blue-600/50 text-white'
                        : 'bg-zinc-950/40 border-zinc-800/80 hover:bg-zinc-800/50 text-zinc-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono">{item.symbol}</span>
                        {item.name && <span className="text-[10px] text-zinc-500 truncate max-w-[80px]">{item.name}</span>}
                      </div>
                      {item.price !== undefined && <span className="text-xs font-mono text-zinc-400">${item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.change24h !== undefined && (
                        <span className={`text-[11px] font-mono flex items-center ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPositive ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                          {isPositive ? '+' : ''}{item.change24h.toFixed(2)}%
                        </span>
                      )}
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:bg-rose-950/50 hover:text-rose-400 text-zinc-500 transition" onClick={(e) => { e.stopPropagation(); removeMutation.mutate(item.symbol); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
      <AddSymbolModal />
    </Card>
  );
}