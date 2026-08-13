'use client';

import React, { useState } from 'react';
import { useMarketStore } from '../store/useMarketStore';

import { Bell, BookmarkPlus, Sparkles, CheckCircle2, X, ShieldAlert } from 'lucide-react';
import { alertService } from '../service/alertService';
import { watchlistService } from '../service/watchlistService';

interface OrionSuggestion {
  symbol: string;
  suggestedPrice: number;
  condition?: 'ABOVE' | 'BELOW';
  rationale?: string;
}

interface WatchlistAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  orionSuggestion?: OrionSuggestion | null;
}

export default function WatchlistAlertModal({
  isOpen,
  onClose,
  userId,
  orionSuggestion,
}: WatchlistAlertModalProps) {
  const { activeSymbol, customSymbols, addCustomSymbol } = useMarketStore();

  const [selectedSymbol, setSelectedSymbol] = useState(orionSuggestion?.symbol || activeSymbol);
  const [customInput, setCustomInput] = useState('');
  const [targetPrice, setTargetPrice] = useState(orionSuggestion?.suggestedPrice?.toString() || '');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW' | 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT'>(
    orionSuggestion?.condition || 'ABOVE'
  );
  
  // Toggle to determine if we use Orion's prompt or manual inputs
  const [useOrionPrompt, setUseOrionPrompt] = useState<boolean>(!!orionSuggestion);
  const [addToWatchlistToo, setAddToWatchlistToo] = useState<boolean>(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const targetSymbol = (customInput || selectedSymbol).toUpperCase().trim();

      // 1. Add to Watchlist if checked
      if (addToWatchlistToo) {
        if (customInput) addCustomSymbol(customInput);
        await watchlistService.addToWatchlist(userId, targetSymbol);
      }

      // 2. Create Alert
      await alertService.createAlert({
        userId,
        symbol: targetSymbol,
        condition,
        thresholdValue: Number(targetPrice),
      });

      setSuccessMsg('Watchlist updated & Orion alert successfully set!');
      setTimeout(() => {
        setIsSubmitting(false);
        setSuccessMsg('');
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Submission failed:', err);
      setErrorMsg(err?.response?.data?.error || 'Failed to complete request.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 relative">
        
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200">
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-xl">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
              Manage Asset Watchlist & Alerts
            </h3>
            <p className="text-xs text-slate-500">Track symbols and let Orion monitor your thresholds.</p>
          </div>
        </div>

        {/* Orion Suggested Entry Banner (If available) */}
        {orionSuggestion && useOrionPrompt && (
          <div className="mb-5 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs space-y-2">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span>Orion Suggested Entry Detected</span>
            </div>
            <p className="text-slate-700 dark:text-slate-300">
              Orion identified a target level for <strong className="font-mono">{orionSuggestion.symbol}</strong> at{' '}
              <strong className="font-mono">${orionSuggestion.suggestedPrice}</strong>. Would you like to place an alert on this suggestion?
            </p>
            {orionSuggestion.rationale && (
              <p className="text-slate-500 italic text-[11px]">&ldquo;{orionSuggestion.rationale}&rdquo;</p>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUseOrionPrompt(false)}
                className="px-3 py-1 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium"
              >
                No, Customize Manually
              </button>
            </div>
          </div>
        )}

        {successMsg ? (
          <div className="flex flex-col items-center justify-center py-10 space-y-2 text-emerald-500 font-mono">
            <CheckCircle2 className="w-10 h-10 animate-bounce" />
            <p className="text-xs font-bold">{successMsg}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs font-mono">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Symbol Selection */}
            <div>
              <label className="block text-slate-500 mb-1">Target Asset Pair</label>
              <select
                value={selectedSymbol}
                onChange={(e) => {
                  setSelectedSymbol(e.target.value);
                  setCustomInput('');
                }}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {customSymbols.map((sym) => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            </div>

            {/* Custom Input Option */}
            <div>
              <label className="block text-slate-500 mb-1">Or Input Custom Symbol</label>
              <input
                type="text"
                placeholder="e.g. ADA/USDT"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Alert Condition and Price Threshold */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 mb-1">Condition</label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ABOVE">Price Rises Above (≥)</option>
                  <option value="BELOW">Price Drops Below (≤)</option>
                  <option value="RSI_OVERSOLD">RSI Oversold (≤)</option>
                  <option value="RSI_OVERBOUGHT">RSI Overbought (≥)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Threshold Value</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="0.00"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Checkbox to also add to Watchlist */}
            <div className="pt-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="watchlist-checkbox"
                checked={addToWatchlistToo}
                onChange={(e) => setAddToWatchlistToo(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-800 text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              <label htmlFor="watchlist-checkbox" className="text-slate-700 dark:text-slate-300 cursor-pointer flex items-center gap-1.5">
                <BookmarkPlus className="w-3.5 h-3.5 text-blue-500" />
                Also add this pair to my active watchlist
              </label>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors shadow-lg shadow-blue-500/20"
              >
                {isSubmitting ? 'Configuring...' : 'Confirm & Save Alert'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}