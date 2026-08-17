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
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Sparkles, List } from 'lucide-react';

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
      <div className="flex flex-col w-screen h-screen overflow-hidden bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white">
        <Header />
        <TriggeredAlertBanner />

        <main className="flex-1 flex flex-col md:flex-row min-h-0 w-full relative overflow-hidden">
          <div
            className={`${mobilePanel === 'chart' ? 'flex' : 'hidden'} md:flex flex-1 h-full min-h-0 relative p-2`}
          >
            <Card className="flex-1 border-0 shadow-none overflow-hidden rounded-xl bg-zinc-950/90 border border-zinc-800">
              <TradingViewChart />
            </Card>
          </div>

          <div
            className={`${mobilePanel === 'insights' || mobilePanel === 'watchlist' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[340px] lg:w-[380px] shrink-0 h-full md:border-l border-zinc-800 bg-black`}
          >
            <Card className="flex-1 border-0 shadow-none rounded-none bg-transparent flex flex-col flex-[3] min-h-0 border-b border-zinc-800">
              <AiInsightsSidebar />
            </Card>

            <Card className="flex-1 border-0 shadow-none rounded-none bg-transparent flex flex-col flex-[2] min-h-0 p-2 md:p-3">
              <WatchlistSidebar />
            </Card>
          </div>
        </main>

        <div className="md:hidden w-full border-t border-zinc-800 bg-black py-2 shrink-0">
          <Tabs value={mobilePanel} onValueChange={(v) => setMobilePanel(v as MobilePanel)} className="w-full">
            <TabsList className="w-full flex justify-around h-12 bg-transparent border-0 p-0">
              <TabsTrigger value="chart" className="flex-1 flex flex-col gap-0.5 data-[state=active]:text-blue-500 text-zinc-400 h-full rounded-none bg-transparent">
                <LineChart className="w-4 h-4" />
                <span className="text-[10px] font-mono">Chart</span>
              </TabsTrigger>
              <TabsTrigger value="insights" className="flex-1 flex flex-col gap-0.5 data-[state=active]:text-blue-500 text-zinc-400 h-full rounded-none bg-transparent">
                <Sparkles className="w-4 h-4" />
                <span className="text-[10px] font-mono">Orion</span>
              </TabsTrigger>
              <TabsTrigger value="watchlist" className="flex-1 flex flex-col gap-0.5 data-[state=active]:text-blue-500 text-zinc-400 h-full rounded-none bg-transparent">
                <List className="w-4 h-4" />
                <span className="text-[10px] font-mono">Watchlist</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

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