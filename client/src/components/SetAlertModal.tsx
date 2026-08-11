'use client';

import React, { useState } from 'react';
import { useMarketStore } from '../store/useMarketStore';
import { Bell, CheckCircle2, X } from 'lucide-react';
import axios from 'axios';

interface SetAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export default function SetAlertModal({ isOpen, onClose, userId }: { isOpen: boolean; onClose: () => void; userId: string }) {
  const { activeSymbol, customSymbols, addCustomSymbol } = useMarketStore();
  
  const [selectedSymbol, setSelectedSymbol] = useState(activeSymbol);
  const [targetPrice, setTargetPrice] = useState('');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [customInput, setCustomInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPrice) return;

    setIsSubmitting(true);
    setSuccessMessage('');

    try {
      // Add custom symbol to local store if user typed a new one
      if (customInput) {
        addCustomSymbol(customInput);
        setSelectedSymbol(customInput.toUpperCase());
      }

      // POST to backend alert engine
      await axios.post('/api/alerts', {
        userId,
        symbol: customInput || selectedSymbol,
        targetPrice: Number(targetPrice),
        condition,
      });

      setSuccessMessage('Orion alert successfully configured!');
      setTimeout(() => {
        setIsSubmitting(false);
        setSuccessMessage('');
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Failed to set alert:', err);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 relative">
        
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200">
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Set Orion Price Alert</h3>
            <p className="text-xs text-slate-500">Get notified instantly when target price is crossed.</p>
          </div>
        </div>

        {successMessage ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-2 text-emerald-500">
            <CheckCircle2 className="w-10 h-10 animate-bounce" />
            <p className="text-xs font-mono font-bold">{successMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs font-mono">
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
                {customSymbols.map((sym: string) => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            </div>

            {/* Optional Custom Pair Input */}
            <div>
              <label className="block text-slate-500 mb-1">Or Add New Pair (e.g. SOL/USDT)</label>
              <input
                type="text"
                placeholder="Leave blank or type symbol..."
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Condition & Target Price */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 mb-1">Condition</label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as 'ABOVE' | 'BELOW')}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ABOVE">Rises Above (≥)</option>
                  <option value="BELOW">Drops Below (≤)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">Target Price ($)</label>
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

            {/* Action Buttons */}
            <div className="pt-2 flex items-center justify-end gap-2">
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
                {isSubmitting ? 'Saving...' : 'Set Orion Alert'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}