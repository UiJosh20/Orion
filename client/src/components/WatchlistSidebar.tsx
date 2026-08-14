'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, Trash2, TrendingUp, TrendingDown, Plus, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useMarketStore } from '../store/useMarketStore';
import { watchlistService } from '../service/watchlistService';
import AddSymbolModal from './AddSymbolModal';

interface WatchlistItem {
  symbol: string;
  name?: string;
  price?: number;
  change24h?: number;
}

/**
 * Recursively locates any array inside the backend payload (up to 3 levels deep)
 * and normalizes the items into WatchlistItem objects.
 */
function normalizeWatchlistResponse(raw: any): WatchlistItem[] {
  if (!raw) return [];

  // Helper to find the first array in an object hierarchy
  const findArray = (obj: any, depth = 0): any[] | null => {
    if (!obj || depth > 3) return null;
    if (Array.isArray(obj)) return obj;

    if (typeof obj === 'object') {
      // Prioritize common backend data keys
      const priorityKeys = ['watchlist', 'data', 'items', 'symbols', 'result', 'payload', 'list'];
      for (const key of priorityKeys) {
        if (Array.isArray(obj[key])) return obj[key];
      }
      // If not in priority keys, scan nested objects
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

  return extractedArray
    .map((item) => {
      // 1. Handle plain string array e.g., ["BTCUSDT", "ETHUSDT"]
      if (typeof item === 'string') {
        return { symbol: item };
      }

      // 2. Handle object array e.g., [{ symbol: "BTCUSDT" }] or [{ ticker: "BTCUSDT" }]
      if (typeof item === 'object' && item !== null) {
        return {
          symbol: item.symbol || item.ticker || item.asset || item.id || '',
          name: item.name || item.title || item.symbol,
          price: item.price ?? item.current_price ?? item.lastPrice,
          change24h: item.change24h ?? item.price_change_percentage_24h ?? item.change,
        };
      }

      return null;
    })
    .filter((item): item is WatchlistItem => Boolean(item && item.symbol));
}

export default function WatchlistSidebar() {
  const queryClient = useQueryClient();
  const { user, deviceUuid } = useAuthStore();
  const { activeSymbol, setActiveSymbol, setSearchOpen } = useMarketStore();

  const ownerId = user?.id || deviceUuid;
  // console.log('Owner ID:', ownerId);

  const { data: watchlist = [], isLoading, isError } = useQuery({
    queryKey: ['watchlist', ownerId],
    queryFn: async () => {
      const raw = await watchlistService.getWatchlist(ownerId);
      // console.log('🔍 [Watchlist Log] Raw API response:', raw);
      
      const normalized = normalizeWatchlistResponse(raw);
      // console.log('✅ [Watchlist Log] Parsed Watchlist Items:', normalized);
      
      return normalized;
    },
    enabled: !!ownerId,
  });

  const safeWatchlist: WatchlistItem[] = Array.isArray(watchlist) ? watchlist : [];

  const removeMutation = useMutation({
    mutationFn: (symbolToRemove: string) =>
      watchlistService.removeFromWatchlist(ownerId, symbolToRemove),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist', ownerId] });
    },
  });

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col h-full relative">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          <h3 className="text-sm font-semibold text-slate-200">Watchlist</h3>
          <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full text-slate-400 font-mono">
            {safeWatchlist.length}
          </span>
        </div>

        <button
          onClick={() => setSearchOpen(true)}
          className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          title="Add asset to watchlist"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-slate-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Loading watchlist...</span>
          </div>
        ) : isError ? (
          <div className="text-center py-8 px-2 border border-dashed border-rose-900/60 rounded-lg">
            <p className="text-xs text-rose-400 font-medium">Couldn't load watchlist</p>
            <p className="text-[11px] text-slate-500 mt-1">Try refreshing the page.</p>
          </div>
        ) : safeWatchlist.length === 0 ? (
          <div className="text-center py-8 px-2 border border-dashed border-slate-800 rounded-lg">
            <p className="text-xs text-slate-400 font-medium">No assets saved</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Search and click the star icon to track symbols.
            </p>
            <button
              onClick={() => setSearchOpen(true)}
              className="mt-3 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded-md transition"
            >
              Add Symbols
            </button>
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
                    : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-800/50 text-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold font-mono">{item.symbol}</span>
                    {item.name && (
                      <span className="text-[10px] text-slate-500 truncate max-w-[80px]">
                        {item.name}
                      </span>
                    )}
                  </div>
                  {item.price !== undefined && (
                    <span className="text-xs font-mono text-slate-400">
                      ${item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {item.change24h !== undefined && (
                    <span
                      className={`text-[11px] font-mono flex items-center ${
                        isPositive ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isPositive ? (
                        <TrendingUp className="w-3 h-3 mr-0.5" />
                      ) : (
                        <TrendingDown className="w-3 h-3 mr-0.5" />
                      )}
                      {isPositive ? '+' : ''}
                      {item.change24h.toFixed(2)}%
                    </span>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMutation.mutate(item.symbol);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-950/50 hover:text-rose-400 rounded text-slate-500 transition"
                    title="Remove from watchlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <AddSymbolModal />
    </div>
  );
}