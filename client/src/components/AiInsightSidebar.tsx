'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Activity, TrendingUp, X } from 'lucide-react';
import { useMarketStore } from '@/src/store/useMarketStore';
import { useAuthStore } from '@/src/store/useAuthStore';
import { api } from '@/src/libs/api/client';
import { ENDPOINTS } from '@/src/constants/endpoints';
import { alertService } from '../service/alertService';
import { aiService } from '../service/aiservice';

const THINKING_STEPS = [
  "Initializing telemetry...",
  "Analyzing price action...",
  "Checking order book & news...",
  "Confirming technical indicators...",
  "Finalizing synthesis..."
];

export default function AiInsightsSidebar() {
  const { activeSymbol, activeInterval, openAlertModal }: any = useMarketStore();
  const userId = useAuthStore((state) => state.user?.id);
  
  const [insight, setInsight] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Modal State Management for Alert Flow
  const [modalStep, setModalStep] = useState<'closed' | 'choose_ai_or_custom' | 'confirm_ai_target' | 'success'>('closed');
  const [isSubmittingAlert, setIsSubmittingAlert] = useState(false);
  const [alertSuccessMsg, setAlertSuccessMsg] = useState('');

  // Helper to remove markdown bolding (**)
  const cleanText = (text: string) => {
    if (!text) return '';
    return text.replace(/\*\*(.*?)\*\*/g, '$1');
  };

  // Helper to format numbers with commas for thousands and 2 decimal places
  const formatPrice = (val: any) => {
    const num = Number(val);
    if (isNaN(num)) return val;
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Helper to parse the numbered AI response into structured, spaced-out points
  const parseInsightSections = (text: string) => {
    if (!text) return [];
    const cleaned = cleanText(text);
    const rawParts = cleaned.split(/(?=\d+\.\s+[A-Za-z\s&]+:)/);
    
    return rawParts.filter(Boolean).map((part) => {
      const match = part.match(/^(\d+\.)\s*([A-Za-z\s&]+):\s*([\s\S]*)$/);
      if (match) {
        return {
          num: match[1],
          title: match[2].trim(),
          body: match[3].trim(),
        };
      }
      return { num: '', title: '', body: part.trim() };
    });
  };

  // Helper to extract specific target price from the Conditional Setup & Entry section
  const extractAiTargetPrice = (text: string) => {
    if (!text) return insight?.suggestedPrice || insight?.indicators?.sma || 0;
    const sections = parseInsightSections(text);
    const entrySection = sections.find(s => 
      s.title.toLowerCase().includes('conditional') || 
      s.title.toLowerCase().includes('entry') || 
      s.title.toLowerCase().includes('setup')
    );
    const targetText = entrySection ? entrySection.body : text;
    
    const matches = targetText.match(/\$([\d,]+(?:\.\d+)?)/g);
    if (matches && matches.length > 0) {
      const cleanNum = matches[0].replace('$', '').replace(/,/g, '');
      return Number(cleanNum);
    }
    return Number(insight?.suggestedPrice || insight?.indicators?.sma || 0);
  };

  // Progressive loading step cycler timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setCurrentStepIndex(0);
      interval = setInterval(() => {
        setCurrentStepIndex((prev) => (prev < THINKING_STEPS.length - 1 ? prev + 1 : prev));
      }, 1600);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Fetch insight automatically when symbol or interval changes
  const fetchInsight = useCallback(async () => {
    if (!activeSymbol) return;
    
    setIsLoading(true);
    setError('');
    setInsight(null);
    setModalStep('closed');

    try {
      const response = await aiService.getInsight(activeSymbol, activeInterval);
      setInsight(response);
    } catch (err: any) {
      console.error('Failed to fetch AI insight:', err);
      setError(err?.response?.data?.error || err.message || 'Failed to generate market insights.');
    } finally {
      setIsLoading(false);
    }
  }, [activeSymbol, activeInterval]);

  useEffect(() => {
    fetchInsight();
  }, [fetchInsight]);

  const sections = insight?.aiInsight ? parseInsightSections(insight.aiInsight) : [];
  const targetPrice = extractAiTargetPrice(insight?.aiInsight);

  // Handlers for Alert Flow
  const handleConfirmAiAlertCreation = async () => {
    if (!userId) {
      setModalStep('closed');
      openAlertModal({
        symbol: activeSymbol,
        suggestedPrice: Number(targetPrice),
        condition: 'ABOVE',
        rationale: cleanText('Orion AI conditional entry target level.')
      });
      return;
    }

    setIsSubmittingAlert(true);
    try {
      await alertService.createAlert({
        userId,
        symbol: activeSymbol,
        condition: 'ABOVE',
        thresholdValue: targetPrice,
      });
      setAlertSuccessMsg(`Alert successfully created for ${activeSymbol} at $${formatPrice(targetPrice)}!`);
      setModalStep('success');
      setTimeout(() => {
        setModalStep('closed');
      }, 3000);
    } catch (err: any) {
      console.error('Failed to create alert via endpoint:', err);
      setModalStep('closed');
      openAlertModal({
        symbol: activeSymbol,
        suggestedPrice: Number(targetPrice),
        condition: 'ABOVE',
        rationale: cleanText('Orion AI conditional entry target level.')
      });
    } finally {
      setIsSubmittingAlert(false);
    }
  };

  const handleChooseNoCustom = () => {
    setModalStep('closed');
    openAlertModal({
      symbol: activeSymbol,
      suggestedPrice: undefined,
      condition: 'ABOVE',
      rationale: cleanText('Custom user alert target level.')
    });
  };

  return (
    <aside className="w-full lg:w-96 h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col p-5 font-mono text-xs overflow-y-auto transition-colors relative">
      
      {/* Sidebar Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 mb-5 shrink-0">
        <div className="text-slate-900 dark:text-slate-100 font-bold tracking-wide">
          Orion Intelligence
        </div>
        <div className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-md">
          {activeSymbol} ({activeInterval})
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col space-y-4">
        {isLoading ? (
          <div className="p-6 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3 mt-2">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="text-blue-600 dark:text-blue-400 font-bold">Live Telemetry Scan</span>
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
            </div>
            <p className="text-slate-800 dark:text-slate-200 text-sm font-medium transition-all duration-300">
              {THINKING_STEPS[currentStepIndex]}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Evaluating market structure and indicator thresholds...
            </p>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 space-y-2 mt-2">
            <div className="font-bold">
              Synthesis Interrupted
            </div>
            <p className="text-[11px] text-red-500 dark:text-red-300/80 leading-relaxed">{cleanText(error)}</p>
          </div>
        ) : insight ? (
          <div className="space-y-4 pb-6">
            
            {/* Technical Indicators Summary Bar */}
            {insight.indicators && (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 text-[11px]">
                    <Activity className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> RSI
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-200 font-mono text-sm">{insight.indicators.rsi}</span>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 text-[11px]">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> SMA
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-200 font-mono text-sm">
                    {formatPrice(insight.indicators.sma)}
                  </span>
                </div>
              </div>
            )}

            {/* Well-Spaced Report Sections */}
            <div className="space-y-3">
              {sections.length > 0 ? (
                sections.map((sec, idx) => (
                  <div key={idx} className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 rounded-xl space-y-1.5">
                    {sec.title && (
                      <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                        {sec.num} {sec.title}
                      </div>
                    )}
                    <p className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                      {sec.body}
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                  {cleanText(insight.aiInsight)}
                </div>
              )}
            </div>

            {/* Target Alert Action Button */}
            {targetPrice > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setModalStep('choose_ai_or_custom')}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center shadow-lg shadow-blue-500/20 text-xs"
                >
                  <span>Set Alert on Target (${formatPrice(targetPrice)})</span>
                </button>
              </div>
            )}

          </div>
        ) : (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400 space-y-2">
            <p>Initializing telemetry for <strong className="text-slate-900 dark:text-slate-300">{activeSymbol}</strong>...</p>
          </div>
        )}
      </div>

      {/* Alert Flow Modal Overlay */}
      {modalStep !== 'closed' && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                {modalStep === 'success' ? 'Alert Confirmed' : 'Price Alert Configuration'}
              </span>
              <button 
                onClick={() => setModalStep('closed')}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalStep === 'choose_ai_or_custom' && (
              <div className="space-y-4">
                <p className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                  Would you like to use Orion&apos;s conditional entry target of <strong className="text-blue-600 dark:text-blue-400">${formatPrice(targetPrice)}</strong> extracted from the analysis?
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={() => setModalStep('confirm_ai_target')}
                    className="py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors text-center text-xs"
                  >
                    Yes
                  </button>
                  <button
                    onClick={handleChooseNoCustom}
                    className="py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition-colors text-center text-xs"
                  >
                    No, Custom
                  </button>
                </div>
              </div>
            )}

            {modalStep === 'confirm_ai_target' && (
              <div className="space-y-4">
                <p className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                  Are you sure you want to set the alert for <strong className="text-slate-900 dark:text-slate-100">{activeSymbol}</strong> at target price <strong className="text-blue-600 dark:text-blue-400">${formatPrice(targetPrice)}</strong>?
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={handleConfirmAiAlertCreation}
                    disabled={isSubmittingAlert}
                    className="py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-center text-xs flex items-center justify-center"
                  >
                    {isSubmittingAlert ? 'Setting...' : 'Yes, Create'}
                  </button>
                  <button
                    onClick={() => setModalStep('choose_ai_or_custom')}
                    disabled={isSubmittingAlert}
                    className="py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition-colors text-center text-xs"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            {modalStep === 'success' && (
              <div className="space-y-3 py-2 text-center">
                <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-base">
                  ✓
                </div>
                <p className="text-slate-800 dark:text-slate-200 text-xs font-medium leading-relaxed">
                  {alertSuccessMsg}
                </p>
              </div>
            )}

          </div>
        </div>
      )}

    </aside>
  );
}