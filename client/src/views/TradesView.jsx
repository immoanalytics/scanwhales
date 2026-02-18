import React, { useState, useEffect, useMemo } from 'react';
import * as api from '../api';

export default function TradesView({ liveTrades }) {
  const [historicalTrades, setHistoricalTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    coin: '',
    side: '',
    min_notional: '',
    whale_address: '',
  });
  const [page, setPage] = useState(0);

  useEffect(() => {
    loadTrades();
  }, [filters]);

  async function loadTrades(offset = 0) {
    setLoading(true);
    try {
      const trades = await api.getTrades({
        ...filters,
        limit: 100,
        offset,
      });
      if (offset === 0) {
        setHistoricalTrades(trades);
      } else {
        setHistoricalTrades((prev) => [...prev, ...trades]);
      }
      setPage(offset);
    } catch (e) {
      console.error('Failed to load trades:', e);
    }
    setLoading(false);
  }

  // Merge live trades with historical, dedup by tid
  const allTrades = useMemo(() => {
    const seenTids = new Set();
    const merged = [];

    for (const t of liveTrades) {
      const key = t.tid || `${t.time}-${t.whale_address}`;
      if (!seenTids.has(key)) {
        seenTids.add(key);
        // Apply filters to live trades
        if (filters.coin && t.coin !== filters.coin) continue;
        if (filters.side && t.side !== filters.side) continue;
        if (filters.min_notional && t.notional < parseFloat(filters.min_notional)) continue;
        if (filters.whale_address && t.whale_address !== filters.whale_address) continue;
        merged.push(t);
      }
    }

    for (const t of historicalTrades) {
      const key = t.tid || `${t.time}-${t.whale_address}`;
      if (!seenTids.has(key)) {
        seenTids.add(key);
        merged.push(t);
      }
    }

    return merged;
  }, [liveTrades, historicalTrades, filters]);

  return (
    <div>
      <div className="filter-bar">
        <div className="filter-group">
          <label>Pair</label>
          <input
            type="text"
            placeholder="e.g. BTC"
            value={filters.coin}
            onChange={(e) => setFilters((f) => ({ ...f, coin: e.target.value.toUpperCase() }))}
            style={{ width: 100 }}
          />
        </div>
        <div className="filter-group">
          <label>Side</label>
          <select
            value={filters.side}
            onChange={(e) => setFilters((f) => ({ ...f, side: e.target.value }))}
          >
            <option value="">All</option>
            <option value="B">Buy</option>
            <option value="A">Sell</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Min Notional ($)</label>
          <input
            type="number"
            placeholder="50000"
            value={filters.min_notional}
            onChange={(e) => setFilters((f) => ({ ...f, min_notional: e.target.value }))}
            style={{ width: 120 }}
          />
        </div>
        <div className="filter-group">
          <label>Whale Address</label>
          <input
            type="text"
            placeholder="0x..."
            value={filters.whale_address}
            onChange={(e) => setFilters((f) => ({ ...f, whale_address: e.target.value }))}
            style={{ width: 180 }}
          />
        </div>
      </div>

      <div className="table-container">
        <div className="trade-list">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Pair</th>
                <th>Side</th>
                <th>Price</th>
                <th>Size</th>
                <th>Notional</th>
                <th>Whale</th>
              </tr>
            </thead>
            <tbody>
              {allTrades.length === 0 && !loading && (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">
                      <h3>No whale trades yet</h3>
                      <p>Waiting for large trades on monitored pairs...</p>
                    </div>
                  </td>
                </tr>
              )}
              {allTrades.map((t, i) => (
                <tr key={t.tid || `${t.time}-${i}`} className={t._isNew ? 'trade-new' : ''}>
                  <td>{formatTime(t.time)}</td>
                  <td style={{ fontWeight: 600 }}>{t.coin}</td>
                  <td className={t.side === 'B' ? 'side-buy' : 'side-sell'}>
                    {t.side === 'B' ? 'BUY' : 'SELL'}
                  </td>
                  <td>${formatPrice(t.price)}</td>
                  <td>{formatSize(t.size)}</td>
                  <td style={{ fontWeight: 600 }}>${formatNotional(t.notional)}</td>
                  <td>
                    <span className="addr" title={t.whale_address}>
                      {shortAddr(t.whale_address)}
                    </span>
                    {t.whale_label && <span className="whale-label">{t.whale_label}</span>}
                    {t._isNewWhale && <span className="new-whale-badge">New Whale</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {allTrades.length > 0 && (
          <div className="load-more">
            <button
              className="btn btn-sm btn-primary"
              onClick={() => loadTrades(page + 100)}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatPrice(p) {
  if (!p) return '-';
  if (p >= 1000) return Number(p).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return Number(p).toFixed(4);
  return Number(p).toPrecision(4);
}

function formatSize(s) {
  if (!s) return '-';
  if (s >= 1000) return Number(s).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return Number(s).toPrecision(4);
}

function formatNotional(n) {
  if (!n) return '-';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function shortAddr(addr) {
  if (!addr) return '-';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}
