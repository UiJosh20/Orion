'use client';

import React, { useEffect, useState, useRef } from 'react';
import { BellRing, X, Volume2, VolumeX } from 'lucide-react';
import { AudioService } from '../libs/audio';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface TriggeredAlert {
  id: string; symbol: string; price: number; condition: string; threshold: number; timestamp?: string;
}

export function TriggeredAlertBanner() {
  const [alerts, setAlerts] = useState<TriggeredAlert[]>([]);
  const [soundMuted, setSoundMuted] = useState(false);
  const activeAlertIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleAlertEvent = (event: CustomEvent<TriggeredAlert>) => {
      const newAlert = event.detail;
      setAlerts((prev) => prev.some(a => a.id === newAlert.id) ? prev : [newAlert, ...prev]);
      if (!soundMuted) {
        AudioService.stopAlertSound();
        AudioService.playAlertSound(String(newAlert.id));
        activeAlertIds.current.add(String(newAlert.id));
      }
    };
    window.addEventListener('orion_alert_triggered' as any, handleAlertEvent);
    return () => { window.removeEventListener('orion_alert_triggered' as any, handleAlertEvent); AudioService.stopAlertSound(); activeAlertIds.current.clear(); };
  }, [soundMuted]);

  useEffect(() => { if (alerts.length === 0) { AudioService.stopAlertSound(); activeAlertIds.current.clear(); } }, [alerts.length]);

  const dismissAlert = (id: string) => {
    setAlerts((prev) => {
      const remaining = prev.filter((a) => a.id !== id);
      if (remaining.length === 0) { AudioService.stopAlertSound(); activeAlertIds.current.delete(id); }
      return remaining;
    });
  };

  const toggleSound = () => {
    const newState = !soundMuted;
    setSoundMuted(newState);
    if (newState) AudioService.stopAlertSound();
    else if (alerts.length > 0) { const latestAlert = alerts[0]; AudioService.playAlertSound(String(latestAlert.id)); activeAlertIds.current.add(String(latestAlert.id)); }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full px-2 pointer-events-none">
      <div className="flex justify-end pointer-events-auto">
        <Button variant="outline" size="sm" onClick={toggleSound} className="flex items-center gap-1.5 text-[11px] font-mono bg-zinc-950/90 border-zinc-800 text-zinc-300 hover:bg-zinc-800 backdrop-blur-sm h-8">
          {soundMuted ? <VolumeX className="w-3.5 h-3.5 text-amber-500" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />}
          {soundMuted ? 'Sound Muted' : 'Sound Active'}
        </Button>
      </div>

      {alerts.map((alert) => (
        <Card key={alert.id} className="pointer-events-auto bg-zinc-950/95 border-red-500/50 text-zinc-100 p-4 rounded-xl shadow-2xl flex items-start gap-3 backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200 border-0">
          <div className="p-2 bg-red-500/10 text-red-500 rounded-xl shrink-0 animate-pulse">
            <BellRing className="w-5 h-5" />
          </div>
          <div className="flex-1 text-xs font-mono space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-red-400 tracking-wider">🚨 TARGET HIT: {alert.symbol}</span>
            </div>
            <p className="text-zinc-300">Price reached <strong className="text-white font-bold">${alert.price.toLocaleString()}</strong> ({alert.condition} ${alert.threshold.toLocaleString()})</p>
            {alert.timestamp && <p className="text-[10px] text-zinc-500">{new Date(alert.timestamp).toLocaleTimeString()}</p>}
          </div>
          <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white h-6 w-6 rounded-lg hover:bg-zinc-800" onClick={() => dismissAlert(alert.id)}>
            <X className="w-4 h-4" />
          </Button>
        </Card>
      ))}
    </div>
  );
}