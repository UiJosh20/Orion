'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { 
  Star, 
  Zap, 
  ShieldCheck, 
  BarChart3, 
  ArrowRight, 
  // Github, 
  User, 
  Bot,
  Activity,
  GitBranch
} from 'lucide-react';

function TradingViewSummaryWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [
        ['Bitcoin', 'BINANCE:BTCUSDT|1D']
      ],
      chartOnly: true,
      width: '100%',
      height: '100%',
      locale: 'en',
      colorTheme: 'dark',
      autosize: true,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: true,
      hideSymbolLogo: true,
      scalePosition: 'right',
      scaleMode: 'Normal',
      fontFamily: '-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif',
      noTimeScale: false,
      valuesTracking: '1',
      changeMode: 'price-and-percent',
      chartType: 'area',
      backgroundColor: '#09090b',
      lineColor: '#10b981',
      bottomColor: 'rgba(16, 185, 129, 0.05)',
      topColor: 'rgba(16, 185, 129, 0.25)',
    });

    containerRef.current.appendChild(script);
  }, []);

  return (
    <div className="w-full h-[400px] rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden shadow-2xl backdrop-blur-sm">
      <div className="tradingview-widget-container h-full w-full" ref={containerRef}>
        <div className="tradingview-widget-container__widget h-full w-full" />
      </div>
    </div>
  );
}

export default function Home() {
  const [isStarred, setIsStarred] = useState(false);
  const [starCount, setStarCount] = useState(142);

  useEffect(() => {
    const savedState = localStorage.getItem('orion_repo_starred');
    if (savedState === 'true') {
      setIsStarred(true);
      setStarCount((prev) => prev + 1);
    }
  }, []);

  const handleStarToggle = () => {
    const nextState = !isStarred;
    setIsStarred(nextState);
    localStorage.setItem('orion_repo_starred', String(nextState));
    setStarCount((prev) => (nextState ? prev + 1 : prev - 1));

    if (nextState) {
      window.open('https://github.com/UiJosh20/orion', '_blank');
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white flex flex-col">
      {/* Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-black/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          
          {/* Left Side: GitHub Star Button */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleStarToggle}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-all duration-200 ${
                isStarred
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-400 text-amber-400' : 'text-zinc-400'}`} />
              <span>{isStarred ? 'Starred' : 'Star on GitHub'}</span>
              <span className="ml-1 pl-2 border-l border-zinc-700 text-zinc-400 font-mono text-[11px]">
                {starCount}
              </span>
            </button>
          </div>

          {/* Center: Brand Title */}
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-widest text-white">ORION</span>
          </div>

          {/* Right Side: Account & Launch App */}
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/UiJosh20"
              target="_blank"
              rel="noreferrer"
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
              title="UiJosh20 Profile"
            >
              <User className="w-4 h-4" />
            </a>
            <Link
              href="/watcher"
              className="hidden sm:inline-flex items-center justify-center h-9 px-4 rounded-md bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors"
            >
              Launch App
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 flex flex-col gap-16">
        
        {/* Hero Section */}
        <section className="flex flex-col items-center text-center gap-6 pt-8 pb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-400">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Quantitative Intelligence Protocol</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight max-w-3xl text-balance">
            Real-Time Market Analysis Powered by <span className="text-zinc-400">ORION</span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-400 max-w-2xl text-balance">
            An advanced financial intelligence engine delivering low-latency charts, premium automated strategies, and institutional-grade price action insights.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <Link
              href="/watcher"
              className="w-full sm:w-auto flex items-center justify-center gap-2 h-11 px-6 rounded-md bg-white text-black font-medium text-sm hover:bg-zinc-200 transition-colors"
            >
              Get Started Free <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="https://github.com/UiJosh20/orion"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto flex items-center justify-center gap-2 h-11 px-6 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-200 font-medium text-sm hover:bg-zinc-800 hover:border-zinc-700 transition-colors"
            >
              <GitBranch className="w-4 h-4" /> View Source
            </a>
          </div>
        </section>

        {/* Clean Chart Summary Section */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-zinc-400" />
              <h2 className="text-sm font-semibold tracking-wide text-zinc-200 uppercase">Market Overview Summary</h2>
            </div>
            <span className="text-xs text-zinc-500 font-mono">BTC/USDT</span>
          </div>
          <TradingViewSummaryWidget />
        </section>

        {/* Features Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
          <div className="p-6 rounded-xl border border-zinc-800/80 bg-zinc-950/50 flex flex-col gap-3 hover:border-zinc-700 transition-colors">
            <div className="p-2.5 w-fit rounded-lg bg-zinc-900 border border-zinc-800 text-white">
              <Bot className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-zinc-100">Automated Strategy Execution</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Define custom order rules and let ORION monitor order blocks, liquidity sweeps, and price imbalances automatically.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-zinc-800/80 bg-zinc-950/50 flex flex-col gap-3 hover:border-zinc-700 transition-colors">
            <div className="p-2.5 w-fit rounded-lg bg-zinc-900 border border-zinc-800 text-white">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-zinc-100">Low-Latency Data Streaming</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Real-time tick updates connected through persistent WebSockets ensuring sub-millisecond chart synchronization.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-zinc-800/80 bg-zinc-950/50 flex flex-col gap-3 hover:border-zinc-700 transition-colors">
            <div className="p-2.5 w-fit rounded-lg bg-zinc-900 border border-zinc-800 text-white">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-zinc-100">Risk Management Overlays</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Interactive position boxes with automatic risk-to-reward ratio calculations, take-profit levels, and trailing stop overlays.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 bg-black py-8 mt-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-300">ORION</span>
            <span>&copy; {new Date().getFullYear()} Built by UiJosh20</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/UiJosh20" target="_blank" rel="noreferrer" className="hover:text-zinc-300 transition-colors">
              GitHub
            </a>
            <Link href="/watcher" className="hover:text-zinc-300 transition-colors">
              App
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}