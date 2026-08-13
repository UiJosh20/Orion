'use client';

import { create } from 'zustand';
import { UTCTimestamp } from 'lightweight-charts';
import { AiDrawing } from '../components/DrawingsOverlay';

export interface TradePosition {
  side: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  target: number;
  time: UTCTimestamp;
}

interface MarketStore {
  activeSymbol: string;
  activeInterval: string;
  riskPercent: number;
  riskRewardRatio: number;
  accountBalance: number;
  activePosition: TradePosition | null;
  aiDrawings: AiDrawing[];
  setActiveSymbol: (symbol: string) => void;
  setActiveInterval: (interval: string) => void;
  setRiskConfig: (riskPercent: number, riskRewardRatio: number) => void;
  setAccountBalance: (balance: number) => void;
  setActivePosition: (position: TradePosition | null) => void;
  setAiDrawings: (drawings: AiDrawing[]) => void;
  alertModalData: any;
  openAlertModal: (data: any) => void;
  closeAlertModal: () => void;
}

export const useMarketStore = create<MarketStore>((set) => ({
  activeSymbol: 'BTCUSDT',
  activeInterval: '1h',
  riskPercent: 1.0,
  riskRewardRatio: 2.0,
  accountBalance: 0,
  activePosition: null,
  aiDrawings: [],
  setActiveSymbol: (activeSymbol) => set({ activeSymbol }),
  setActiveInterval: (activeInterval) => set({ activeInterval }),
  setRiskConfig: (riskPercent, riskRewardRatio) => set({ riskPercent, riskRewardRatio }),
  setAccountBalance: (accountBalance) => set({ accountBalance }),
  setActivePosition: (activePosition) => set({ activePosition }),
  setAiDrawings: (aiDrawings) => set({ aiDrawings }),
  alertModalData: null,
  openAlertModal: (data) => set({ alertModalData: data }),
  closeAlertModal: () => set({ alertModalData: null }),
}));