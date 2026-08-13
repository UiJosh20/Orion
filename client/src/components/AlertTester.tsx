// src/components/AlertTester.tsx
'use client';

import React, { useState } from 'react';
import { useAuthStore } from '@/src/store/useAuthStore';

export function AlertTester() {
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string>('');

  const testAlert = async () => {
    const userId = user?.id;
    
    if (!userId) {
      setResult('❌ No user ID found');
      console.error('[Alert Test] No user ID');
      return;
    }

    console.log('[Alert Test] Testing with userId:', userId);

    setIsLoading(true);
    setResult('Sending test alert...');

    try {
      const response = await fetch('http://localhost:8000/api/alerts/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: userId,
          symbol: 'BTCUSDT',
          price: 63561.48,
          condition: 'ABOVE',
          threshold: 63000,
        }),
      });

      const data = await response.json();
      console.log('[Alert Test] Response:', data);
      
      if (data.status === 'success') {
        setResult(`✅ Alert sent to room: ${data.room}`);
      } else {
        setResult(`❌ Failed: ${data.message}`);
      }
    } catch (error: any) {
      console.error('[Alert Test] Error:', error);
      setResult(`❌ Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed top-20 left-4 z-50">
      <button
        onClick={testAlert}
        disabled={isLoading}
        className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-mono hover:bg-emerald-600 transition-colors disabled:opacity-50 shadow-lg"
      >
        {isLoading ? 'Sending...' : '🔔 Test Alert'}
      </button>
      {result && (
        <div className="mt-2 text-xs font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800 max-w-xs">
          {result}
        </div>
      )}
    </div>
  );
}