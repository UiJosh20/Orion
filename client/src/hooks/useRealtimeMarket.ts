// src/hooks/useRealtimeMarket.ts
import { useEffect, useState } from 'react';
import { useSocket } from '@/src/providers/SocketProvider';

export function useRealtimeMarket(symbol: string) {
  const { socket, isConnected } = useSocket();
  const [latestPrice, setLatestPrice] = useState<number | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState<number | null>(null);
  const [liveInsight, setLiveInsight] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !socket || !symbol) return;

    // Subscribe to symbol ticker feed
    socket.emit('subscribe_ticker', { symbol });

    const handleTickerUpdate = (data: { price: number; change24h: number }) => {
      setLatestPrice(data.price);
      setPriceChangePercent(data.change24h);
    };

    const handleAIUpdate = (data: { symbol: string; insight: string }) => {
      if (data.symbol === symbol) {
        setLiveInsight(data.insight);
      }
    };

    socket.on('ticker_update', handleTickerUpdate);
    socket.on('ai_insight_update', handleAIUpdate);

    return () => {
      socket.emit('unsubscribe_ticker', { symbol });
      socket.off('ticker_update', handleTickerUpdate);
      socket.off('ai_insight_update', handleAIUpdate);
    };
  }, [symbol, isConnected, socket]);

  return { latestPrice, priceChangePercent, liveInsight };
}