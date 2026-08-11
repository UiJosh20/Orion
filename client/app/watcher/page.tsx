'use client';

import React, { useEffect } from 'react';
import AiInsightsSidebar from "@/src/components/AiInsightSidebar";
import Header from "@/src/components/Header";
import TradingViewChart from "@/src/components/TradingVIewChart";
import WatchListAlertModal from "@/src/components/WatchListAlertModal";
import { useMarketStore } from "@/src/store/useMarketStore";
import { useAuthStore } from "@/src/store/useAuthStore";

export default function DashboardPage() {
  const { isAlertModalOpen, closeAlertModal, orionSuggestion } = useMarketStore();
  const { user, deviceUuid, initializeSession } = useAuthStore();

  // Initialize session on mount to guarantee deviceUuid or user profile is loaded
  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  // Use authenticated user ID if logged in, otherwise fallback to the anonymous device UUID
  const userId = user?.id || deviceUuid;

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* 1. TradingView Style Header */}
      <Header />

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
  );
}