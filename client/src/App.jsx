import React, { useState, useEffect, useCallback, useRef } from 'react';
import useWebSocket from './useWebSocket';
import * as api from './api';
import TradesView from './views/TradesView';
import WhalesView from './views/WhalesView';
import SettingsView from './views/SettingsView';

export default function App() {
  const [view, setView] = useState('trades');
  const [stats, setStats] = useState(null);
  const [liveTrades, setLiveTrades] = useState([]);
  const liveTradesRef = useRef([]);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'stats') {
      setStats(msg.data);
    } else if (msg.type === 'whale_trade' || msg.type === 'new_whale_trade') {
      const trade = { ...msg.trade, _isNew: true, _isNewWhale: msg.type === 'new_whale_trade' };
      liveTradesRef.current = [trade, ...liveTradesRef.current].slice(0, 200);
      setLiveTrades([...liveTradesRef.current]);
    } else if (msg.type === 'trade_enriched') {
      // Update live trades in-place with enrichment data (direction, PnL, leverage, etc.)
      const { tid, whale_address, enrichment } = msg;
      liveTradesRef.current = liveTradesRef.current.map((t) =>
        t.tid === tid && t.whale_address === whale_address
          ? { ...t, ...enrichment }
          : t
      );
      setLiveTrades([...liveTradesRef.current]);
    }
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  useEffect(() => {
    api.getStats().then(setStats).catch(console.error);
    const interval = setInterval(() => {
      api.getStats().then(setStats).catch(console.error);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">ScanWhales</div>
          <nav className="nav">
            <button
              className={`nav-btn ${view === 'trades' ? 'active' : ''}`}
              onClick={() => setView('trades')}
            >
              Live Trades
            </button>
            <button
              className={`nav-btn ${view === 'whales' ? 'active' : ''}`}
              onClick={() => setView('whales')}
            >
              Whales
            </button>
            <button
              className={`nav-btn ${view === 'settings' ? 'active' : ''}`}
              onClick={() => setView('settings')}
            >
              Settings
            </button>
          </nav>
        </div>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
          {connected ? 'Live' : 'Disconnected'}
        </div>
      </header>

      <main className="main">
        {stats && (
          <div className="stats-bar">
            <div className="stat-card">
              <div className="stat-label">Tracked Whales</div>
              <div className="stat-value">{stats.trackedWhales}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Whales</div>
              <div className="stat-value">{stats.totalWhales}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Trades (24h)</div>
              <div className="stat-value">{stats.trades24h?.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Volume (24h)</div>
              <div className="stat-value green">
                ${formatCompact(stats.volume24h)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">All-Time Trades</div>
              <div className="stat-value">{stats.totalTrades?.toLocaleString()}</div>
            </div>
          </div>
        )}

        {view === 'trades' && <TradesView liveTrades={liveTrades} />}
        {view === 'whales' && <WhalesView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function formatCompact(num) {
  if (!num) return '0';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toFixed(0);
}
