import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface OrionSuggestion {
  symbol: string;
  suggestedPrice: number;
  condition: 'ABOVE' | 'BELOW';
  rationale?: string;
}

interface MarketState {
  activeSymbol: string;
  activeInterval: string;
  isSearchOpen: boolean;
  customSymbols: string[];
  
  // Modal State & Actions
  isAlertModalOpen: boolean;
  orionSuggestion: OrionSuggestion | null;
  openAlertModal: (suggestion?: OrionSuggestion | null) => void;
  closeAlertModal: () => void;

  // Existing Actions
  setActiveSymbol: (symbol: string) => void;
  setActiveInterval: (interval: string) => void;
  setSearchOpen: (open: boolean) => void;
  addCustomSymbol: (symbol: string) => void;
  removeCustomSymbol: (symbol: string) => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set) => ({
      activeSymbol: 'BTCUSDT',
      activeInterval: '1h',
      isSearchOpen: false,
      customSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD'],

      // Modal Initial States
      isAlertModalOpen: false,
      orionSuggestion: null,

      openAlertModal: (suggestion = null) => set({ isAlertModalOpen: true, orionSuggestion: suggestion }),
      closeAlertModal: () => set({ isAlertModalOpen: false, orionSuggestion: null }),

      setActiveSymbol: (symbol) => set({ activeSymbol: symbol.toUpperCase() }),
      setActiveInterval: (interval) => set({ activeInterval: interval }),
      setSearchOpen: (open) => set({ isSearchOpen: open }),

      addCustomSymbol: (symbol) => set((state) => {
        const formatted = symbol.toUpperCase().trim();
        if (!formatted || state.customSymbols.includes(formatted)) return state;
        return { customSymbols: [...state.customSymbols, formatted] };
      }),

      removeCustomSymbol: (symbol) => set((state) => ({
        customSymbols: state.customSymbols.filter((s) => s !== symbol)
      })),
    }),
    {
      name: 'orion-market-store',
    }
  )
);