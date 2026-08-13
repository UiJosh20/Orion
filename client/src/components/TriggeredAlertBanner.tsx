// src/components/TriggeredAlertBanner.tsx
'use client';

import React, { useEffect, useState, useRef } from 'react';
import { BellRing, X, Volume2, VolumeX } from 'lucide-react';
import { AudioService } from '../libs/audio';

export interface TriggeredAlert {
  id: string;
  symbol: string;
  price: number;
  condition: string;
  threshold: number;
  timestamp?: string;
}

export function TriggeredAlertBanner() {
  const [alerts, setAlerts] = useState<TriggeredAlert[]>([]);
  const [soundMuted, setSoundMuted] = useState(false);
  const activeAlertIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('[Alert Banner] Component mounted, listening for events');

    const handleAlertEvent = (event: CustomEvent<TriggeredAlert>) => {
      console.log('[Alert Banner] 🚨 Alert event received:', event.detail);
      const newAlert = event.detail;
      
      // Add to alerts list
      setAlerts((prev) => {
        // Check if alert already exists
        if (prev.some(a => a.id === newAlert.id)) {
          return prev;
        }
        return [newAlert, ...prev];
      });

      // Play sound if not muted
      if (!soundMuted) {
        // Stop any previous sound before playing new one
        AudioService.stopAlertSound();
        // Play sound for this specific alert
        AudioService.playAlertSound(String(newAlert.id));
        activeAlertIds.current.add(String(newAlert.id));
      }
    };

    window.addEventListener('orion_alert_triggered' as any, handleAlertEvent);

    return () => {
      window.removeEventListener('orion_alert_triggered' as any, handleAlertEvent);
      // Stop sound when component unmounts
      AudioService.stopAlertSound();
      activeAlertIds.current.clear();
    };
  }, [soundMuted]);

  // Stop sound when all alerts are dismissed
  useEffect(() => {
    if (alerts.length === 0) {
      AudioService.stopAlertSound();
      activeAlertIds.current.clear();
    }
  }, [alerts.length]);

  const dismissAlert = (id: string) => {
    console.log('[Alert Banner] Dismissing alert:', id);
    
    // Remove from alerts list
    setAlerts((prev) => {
      const remaining = prev.filter((a) => a.id !== id);
      
      // If this was the last alert, stop the sound
      if (remaining.length === 0) {
        AudioService.stopAlertSound();
        activeAlertIds.current.delete(id);
      }
      
      return remaining;
    });
  };

  const toggleSound = () => {
    const newState = !soundMuted;
    setSoundMuted(newState);
    
    if (newState) {
      // Mute: stop all sounds
      AudioService.stopAlertSound();
    } else {
      // Unmute: if there are active alerts, restart sound
      if (alerts.length > 0) {
        const latestAlert = alerts[0];
        AudioService.playAlertSound(String(latestAlert.id));
        activeAlertIds.current.add(String(latestAlert.id));
      }
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full px-2 pointer-events-none">
      <div className="flex justify-end pointer-events-auto">
        <button
          onClick={toggleSound}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-slate-900/90 border border-slate-800 text-slate-300 rounded-lg shadow-md hover:bg-slate-800 transition-colors backdrop-blur-sm"
        >
          {soundMuted ? (
            <VolumeX className="w-3.5 h-3.5 text-amber-500" />
          ) : (
            <Volume2 className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
          )}
          <span>{soundMuted ? 'Sound Muted' : 'Sound Active'}</span>
        </button>
      </div>

      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="pointer-events-auto bg-slate-950/95 border border-red-500/50 text-slate-100 p-4 rounded-xl shadow-2xl flex items-start gap-3 backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200"
        >
          <div className="p-2 bg-red-500/10 text-red-500 rounded-xl shrink-0 animate-pulse">
            <BellRing className="w-5 h-5" />
          </div>
          
          <div className="flex-1 text-xs font-mono space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-red-400 tracking-wider">
                🚨 TARGET HIT: {alert.symbol}
              </span>
            </div>
            <p className="text-slate-300">
              Price reached <strong className="text-white font-bold">${alert.price.toLocaleString()}</strong> ({alert.condition} ${alert.threshold.toLocaleString()})
            </p>
            {alert.timestamp && (
              <p className="text-[10px] text-slate-500">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </p>
            )}
          </div>

          <button
            onClick={() => dismissAlert(alert.id)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}