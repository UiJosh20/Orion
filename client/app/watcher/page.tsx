// app/watcher/page.tsx (or your dashboard)
'use client';

import React, { useEffect } from 'react';
import AiInsightsSidebar from "@/src/components/AiInsightSidebar";
import Header from "@/src/components/Header";
import TradingViewChart from "@/src/components/TradingVIewChart";
import WatchListAlertModal from "@/src/components/WatchListAlertModal";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";
import { TriggeredAlertBanner } from '@/src/components/TriggeredAlertBanner';
import { SocketProvider } from '@/src/providers/SocketProvider';
import { AlertTester } from '@/src/components/AlertTester';

export default function DashboardPage() {
  const { isAlertModalOpen, closeAlertModal, orionSuggestion } = useMarketStore();
  const { user, deviceUuid, initializeSession } = useAuthStore();

  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  // Use authenticated user ID if logged in, otherwise fallback to the anonymous device UUID
  const userId = user?.id || deviceUuid;

  console.log('[Dashboard] Current userId:', userId);

  return (
    <SocketProvider userId={userId}>
      <div className="flex flex-col w-screen h-screen overflow-hidden bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {/* 1. TradingView Style Header */}
        <Header />
        <TriggeredAlertBanner />
        {/* <AlertTester/> */}

        {/* 2. Main Workspace Container */}
        <main className="flex-1 flex flex-col lg:flex-row min-h-0 w-full relative">
          {/* Full-Screen Canvas Container */}
          <div className="flex-1 h-full min-h-0 relative">
            <TradingViewChart />
          </div>

          {/* AI Insight Sidebar */}
          <AiInsightsSidebar />
        </main>

        {/* 3. Global Watchlist & Price Alert Modal */}
        <WatchListAlertModal
          isOpen={isAlertModalOpen}
          onClose={closeAlertModal}
          userId={userId}
          orionSuggestion={orionSuggestion}
        />
      </div>
    </SocketProvider>
  );
}