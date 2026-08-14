'use client';

import React, { useEffect, useState } from 'react';
import AiInsightsSidebar from "@/src/components/AiInsightSidebar";
import Header from "@/src/components/Header";
import TradingViewChart from "@/src/components/TradingVIewChart";
import WatchlistSidebar from "@/src/components/WatchlistSidebar";
import WatchListAlertModal from "@/src/components/WatchListAlertModal";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { TriggeredAlertBanner } from '@/src/components/TriggeredAlertBanner';
import { SocketProvider } from '@/src/providers/SocketProvider';
import { List, LineChart, Sparkles } from 'lucide-react';

type MobilePanel = 'chart' | 'watchlist' | 'insights';

export default function DashboardPage() {
  const { alertModalData, closeAlertModal } = useMarketStore();
  const { user, deviceUuid, initializeSession } = useAuthStore();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('chart');

  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  const userId = user?.id || deviceUuid;

  return (
    <SocketProvider userId={userId}>
      <div className="flex flex-col w-screen h-screen overflow-hidden bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <Header />
        <TriggeredAlertBanner />

        <main className="flex-1 flex flex-col md:flex-row min-h-0 w-full relative overflow-hidden">
          {/* Chart — now the only left/main column, gets the width the
              watchlist used to take */}
          <div
            className={`${mobilePanel === 'chart' ? 'flex' : 'hidden'} md:flex flex-1 h-full min-h-0 relative`}
          >
            <TradingViewChart />
          </div>

          {/* Right column: AI Insight stacked above Watchlist. Fixed
              width lives here now, not on the individual components. */}
          <div
            className={`${mobilePanel === 'insights' || mobilePanel === 'watchlist' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[340px] lg:w-[380px] shrink-0 h-full md:border-l border-slate-200 dark:border-slate-800`}
          >
            {/* AI Insight — takes the larger share of the column */}
            <div
              className={`${mobilePanel === 'insights' ? 'flex' : 'hidden'} md:flex flex-col flex-[3] min-h-0 border-b border-slate-200 dark:border-slate-800`}
            >
              <AiInsightsSidebar />
            </div>

            {/* Watchlist — stacked underneath, smaller share, own scroll */}
            <div
              className={`${mobilePanel === 'watchlist' ? 'flex' : 'hidden'} md:flex flex-col flex-[2] min-h-0 p-2 md:p-3`}
            >
              <WatchlistSidebar />
            </div>
          </div>
        </main>

        {/* Mobile tab bar — still three destinations, since watchlist
            needs its own full-screen view on small screens even though
            it's stacked with insights on desktop */}
        <nav className="md:hidden flex items-center justify-around border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 py-2 shrink-0">
          <button
            onClick={() => setMobilePanel('chart')}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 text-[10px] font-mono ${mobilePanel === 'chart' ? 'text-blue-500' : 'text-slate-400'}`}
          >
            <LineChart className="w-4 h-4" />
            Chart
          </button>
          <button
            onClick={() => setMobilePanel('insights')}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 text-[10px] font-mono ${mobilePanel === 'insights' ? 'text-blue-500' : 'text-slate-400'}`}
          >
            <Sparkles className="w-4 h-4" />
            Orion
          </button>
          <button
            onClick={() => setMobilePanel('watchlist')}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 text-[10px] font-mono ${mobilePanel === 'watchlist' ? 'text-blue-500' : 'text-slate-400'}`}
          >
            <List className="w-4 h-4" />
            Watchlist
          </button>
        </nav>

        <WatchListAlertModal
          isOpen={!!alertModalData}
          onClose={closeAlertModal}
          userId={userId}
          orionSuggestion={alertModalData}
        />
      </div>
    </SocketProvider>
  );
}