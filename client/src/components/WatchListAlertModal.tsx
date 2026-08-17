'use client';

import React, { useState } from 'react';
import { useMarketStore } from '../store/useMarketStore';
import { Bell, BookmarkPlus, Sparkles, CheckCircle2, ShieldAlert } from 'lucide-react';
import { alertService } from '../service/alertService';
import { watchlistService } from '../service/watchlistService';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";

interface OrionSuggestion { symbol: string; suggestedPrice: number; condition?: 'ABOVE' | 'BELOW'; rationale?: string; }
interface WatchlistAlertModalProps { isOpen: boolean; onClose: () => void; userId: string; orionSuggestion?: OrionSuggestion | null; }

export default function WatchlistAlertModal({ isOpen, onClose, userId, orionSuggestion }: WatchlistAlertModalProps) {
  const { activeSymbol, customSymbols, addCustomSymbol } = useMarketStore();
  const [selectedSymbol, setSelectedSymbol] = useState(orionSuggestion?.symbol || activeSymbol);
  const [customInput, setCustomInput] = useState('');
  const [targetPrice, setTargetPrice] = useState(orionSuggestion?.suggestedPrice?.toString() || '');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW' | 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT'>(orionSuggestion?.condition || 'ABOVE');
  const [useOrionPrompt, setUseOrionPrompt] = useState<boolean>(!!orionSuggestion);
  const [addToWatchlistToo, setAddToWatchlistToo] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const targetSymbol = (customInput || selectedSymbol).toUpperCase().trim();
      if (addToWatchlistToo) { if (customInput) addCustomSymbol(customInput); await watchlistService.addToWatchlist(userId, targetSymbol); }
      await alertService.createAlert({ userId, symbol: targetSymbol, condition, thresholdValue: Number(targetPrice) });
      setSuccessMsg('Watchlist updated & Orion alert successfully set!');
      setTimeout(() => { setIsSubmitting(false); setSuccessMsg(''); onClose(); }, 1500);
    } catch (err: any) { setErrorMsg(err?.response?.data?.error || 'Failed to complete request.'); setIsSubmitting(false); }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 shadow-2xl text-zinc-100">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl"><Bell className="w-5 h-5" /></div>
            <div>
              <DialogTitle className="text-sm text-zinc-100">Manage Asset Watchlist & Alerts</DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">Track symbols and let Orion monitor your thresholds.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {orionSuggestion && useOrionPrompt && (
          <Card className="mb-4 p-4 bg-blue-500/10 border-blue-500/30 text-xs space-y-2 rounded-xl border-0">
            <div className="flex items-center gap-2 text-blue-400 font-bold">
              <Sparkles className="w-4 h-4 animate-pulse" /><span>Orion Suggested Entry Detected</span>
            </div>
            <p className="text-zinc-300">
              Orion identified a target level for <strong className="font-mono">{orionSuggestion.symbol}</strong> at <strong className="font-mono">${orionSuggestion.suggestedPrice}</strong>.
            </p>
            {orionSuggestion.rationale && <p className="text-zinc-500 italic text-[11px]">&ldquo;{orionSuggestion.rationale}&rdquo;</p>}
            <Button variant="outline" size="sm" onClick={() => setUseOrionPrompt(false)} className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">No, Customize Manually</Button>
          </Card>
        )}

        {successMsg ? (
          <div className="flex flex-col items-center justify-center py-10 space-y-2 text-emerald-500 font-mono">
            <CheckCircle2 className="w-10 h-10 animate-bounce" /><p className="text-xs font-bold">{successMsg}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs font-mono">
            {errorMsg && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2"><ShieldAlert className="w-4 h-4" /><span>{errorMsg}</span></div>}

            <div className="space-y-1.5">
              <Label className="text-zinc-400">Target Asset Pair</Label>
              <Select value={selectedSymbol} onValueChange={(v) => { setSelectedSymbol(v as any); setCustomInput(''); }}>
                <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 text-zinc-300 focus:ring-zinc-700">
                  <SelectValue placeholder="Select Asset" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-300">
                  {customSymbols.map((sym) => <SelectItem key={sym} value={sym}>{sym}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-400">Or Input Custom Symbol</Label>
              <Input type="text" placeholder="e.g. ADA/USDT" value={customInput} onChange={(e) => setCustomInput(e.target.value.toUpperCase())} className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 text-xs font-mono focus-visible:ring-zinc-700" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Condition</Label>
                <Select value={condition} onValueChange={(v) => setCondition(v as any)}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-300 focus:ring-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-300">
                    <SelectItem value="ABOVE">Price Rises Above (≥)</SelectItem>
                    <SelectItem value="BELOW">Price Drops Below (≤)</SelectItem>
                    <SelectItem value="RSI_OVERSOLD">RSI Oversold (≤)</SelectItem>
                    <SelectItem value="RSI_OVERBOUGHT">RSI Overbought (≥)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Threshold Value</Label>
                <Input type="number" step="any" required placeholder="0.00" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 text-xs font-mono focus-visible:ring-zinc-700" />
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <Checkbox id="watchlist-checkbox" checked={addToWatchlistToo} onCheckedChange={(checked) => setAddToWatchlistToo(checked as boolean)} className="data-[state=checked]:bg-blue-600 border-zinc-700" />
              <Label htmlFor="watchlist-checkbox" className="text-zinc-300 flex items-center gap-1.5 cursor-pointer">
                <BookmarkPlus className="w-3.5 h-3.5 text-blue-500" /> Also add this pair to my active watchlist
              </Label>
            </div>

            <div className="pt-4 flex items-center justify-end gap-2 border-t border-zinc-800">
              <Button type="button" variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800">Cancel</Button>
              <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-500 text-white"> {isSubmitting ? 'Configuring...' : 'Confirm & Save Alert'} </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}