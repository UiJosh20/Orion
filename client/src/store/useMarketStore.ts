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

export interface OrionSuggestion {
  symbol: string;
  suggestedPrice: number;
  condition?: 'ABOVE' | 'BELOW';
  rationale?: string;
}

export interface ConfirmedTrade {
  id: string;
  symbol: string;
  interval: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  target: number;
  confidence: 'MEDIUM' | 'HIGH';
  createdAt: number; // unix seconds — anchors the box's X position permanently
}

interface MarketStore {
  activeSymbol: string;
  activeInterval: string;
  riskPercent: number;
  riskRewardRatio: number;
  accountBalance: number;
  activePosition: TradePosition | null;
  aiDrawings: AiDrawing[];

  // Permanent log of every MEDIUM/HIGH confidence trade the AI has
  // surfaced. Append-only from the app's perspective — entries are only
  // removed if the user explicitly dismisses one via the chart's ✕.
  confirmedTrades: ConfirmedTrade[];

  // Modal & Search Visibility State
  isSearchOpen: boolean;
  isAlertModalOpen: boolean;
  orionSuggestion: OrionSuggestion | null;
  customSymbols: string[];
  alertModalData: any;

  // Actions
  setActiveSymbol: (symbol: string) => void;
  setActiveInterval: (interval: string) => void;
  setRiskConfig: (riskPercent: number, riskRewardRatio: number) => void;
  setAccountBalance: (balance: number) => void;
  setActivePosition: (position: TradePosition | null) => void;
  setAiDrawings: (drawings: AiDrawing[]) => void;
  addConfirmedTrade: (trade: ConfirmedTrade) => void;
  removeConfirmedTrade: (id: string) => void;
  setSearchOpen: (isOpen: boolean) => void;
  setIsAlertModalOpen: (isOpen: boolean) => void;
  setOrionSuggestion: (suggestion: OrionSuggestion | null) => void;
  addCustomSymbol: (symbol: string) => void;
  openAlertModal: (data?: any) => void;
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
  confirmedTrades: [],

  // Default Initial States
  isSearchOpen: false,
  isAlertModalOpen: false,
  orionSuggestion: null,
  customSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
  alertModalData: null,

  setActiveSymbol: (activeSymbol) => set({ activeSymbol }),
  setActiveInterval: (activeInterval) => set({ activeInterval }),
  setRiskConfig: (riskPercent, riskRewardRatio) => set({ riskPercent, riskRewardRatio }),
  setAccountBalance: (accountBalance) => set({ accountBalance }),
  setActivePosition: (activePosition) => set({ activePosition }),
  setAiDrawings: (aiDrawings) => set({ aiDrawings }),

  addConfirmedTrade: (trade) =>
    set((state) => ({ confirmedTrades: [...state.confirmedTrades, trade] })),
  removeConfirmedTrade: (id) =>
    set((state) => ({ confirmedTrades: state.confirmedTrades.filter((t) => t.id !== id) })),

  setSearchOpen: (isSearchOpen) => set({ isSearchOpen }),
  setIsAlertModalOpen: (isAlertModalOpen) => set({ isAlertModalOpen }),
  setOrionSuggestion: (orionSuggestion) => set({ orionSuggestion }),

  addCustomSymbol: (symbol) =>
    set((state) => {
      const formatted = symbol.toUpperCase().trim();
      if (!formatted || state.customSymbols.includes(formatted)) return state;
      return { customSymbols: [...state.customSymbols, formatted] };
    }),

  openAlertModal: (data) =>
    set({
      alertModalData: data,
      isAlertModalOpen: true,
      orionSuggestion: data?.orionSuggestion || null,
    }),

  closeAlertModal: () =>
    set({
      alertModalData: null,
      isAlertModalOpen: false,
      orionSuggestion: null,
    }),
}));