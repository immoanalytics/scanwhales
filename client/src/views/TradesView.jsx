import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as api from '../api';

const HL_EXPLORER = 'https://app.hyperliquid.xyz';

const COLUMNS = [
  { key: 'time', label: 'Time', sortable: true },
  { key: 'coin', label: 'Pair', sortable: true },
  { key: 'side', label: 'Side', sortable: true },
  { key: 'direction', label: 'Direction', sortable: true },
  { key: 'price', label: 'Price', sortable: true },
  { key: 'size', label: 'Size', sortable: true },
  { key: 'notional', label: 'Notional', sortable: true },
  { key: 'leverage', label: 'Leverage', sortable: true },
  { key: 'closed_pnl', label: 'PnL', sortable: true },
  { key: 'fee', label: 'Fee', sortable: true },
  { key: 'whale', label: 'Whale', sortable: false },
  { key: 'link', label: 'Link', sortable: false },
];

export default function TradesView({ liveTrades }) {
  const [historicalTrades, setHistoricalTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    coin: '',
    side: '',
    min_notional: '',
    whale_address: '',
    direction: '',
  });
  const [sort, setSort] = useState({ column: 'time', dir: 'DESC' });
  const [page, setPage] = useState(0);

  useEffect(() => {
    loadTrades();
  }, [filters, sort]);

  async function loadTrades(offset = 0) {
    setLoading(true);
    try {
      const trades = await api.getTrades({
        ...filters,
        limit: 100,
        offset,
        sort_by: sort.column,
        sort_dir: sort.dir,
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

  const toggleSort = useCallback((column) => {
    setSort((prev) => {
      if (prev.column === column) {
        return { column, dir: prev.dir === 'DESC' ? 'ASC' : 'DESC' };
      }
      // Default direction per column type
      const defaultDesc = ['time', 'notional', 'price', 'size', 'leverage', 'fee', 'closed_pnl'];
      return { column, dir: defaultDesc.includes(column) ? 'DESC' : 'ASC' };
    });
  }, []);

  // Merge live trades with historical, dedup by tid+whale_address
  const deduped = useMemo(() => {
    const seen = new Set();
    const merged = [];

    for (const t of liveTrades) {
      const key = `${t.tid}:${t.whale_address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (filters.coin && t.coin !== filters.coin) continue;
      if (filters.side && t.side !== filters.side) continue;
      if (filters.min_notional && t.notional < parseFloat(filters.min_notional)) continue;
      if (filters.whale_address && t.whale_address !== filters.whale_address) continue;
      if (filters.direction && t.direction !== filters.direction) continue;
      merged.push(t);
    }

    for (const t of historicalTrades) {
      const key = `${t.tid}:${t.whale_address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }

    return merged;
  }, [liveTrades, historicalTrades, filters]);

  // Client-side sort on the merged set
  const allTrades = useMemo(() => {
    const col = sort.column;
    const mult = sort.dir === 'ASC' ? 1 : -1;

    return [...deduped].sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      // Handle nulls — push to end
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      // Strings
      if (typeof va === 'string' && typeof vb === 'string') {
        return mult * va.localeCompare(vb);
      }

      // Numbers
      return mult * (Number(va) - Number(vb));
    });
  }, [deduped, sort]);

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
          <label>Direction</label>
          <select
            value={filters.direction}
            onChange={(e) => setFilters((f) => ({ ...f, direction: e.target.value }))}
          >
            <option value="">All</option>
            <option value="Open Long">Open Long</option>
            <option value="Open Short">Open Short</option>
            <option value="Close Long">Close Long</option>
            <option value="Close Short">Close Short</option>
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
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={col.sortable ? 'sortable-th' : ''}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  >
                    <span className="th-content">
                      {col.label}
                      {col.sortable && (
                        <SortIndicator column={col.key} active={sort.column} dir={sort.dir} />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allTrades.length === 0 && !loading && (
                <tr>
                  <td colSpan={COLUMNS.length}>
                    <div className="empty-state">
                      <h3>No whale trades yet</h3>
                      <p>Waiting for large trades on monitored pairs...</p>
                    </div>
                  </td>
                </tr>
              )}
              {allTrades.map((t, i) => (
                <tr key={`${t.tid}:${t.whale_address}:${i}`} className={t._isNew ? 'trade-new' : ''}>
                  <td>{formatTime(t.time)}</td>
                  <td style={{ fontWeight: 600 }}>{t.coin}</td>
                  <td className={t.side === 'B' ? 'side-buy' : 'side-sell'}>
                    {t.side === 'B' ? 'BUY' : 'SELL'}
                  </td>
                  <td>
                    {t.direction ? (
                      <span className={`dir-badge ${dirClass(t.direction)}`}>
                        {t.direction}
                      </span>
                    ) : (
                      <span className="pending-dot" title="Enriching...">--</span>
                    )}
                  </td>
                  <td>${formatPrice(t.price)}</td>
                  <td>{formatSize(t.size)}</td>
                  <td style={{ fontWeight: 600 }}>${formatNotional(t.notional)}</td>
                  <td>
                    {t.leverage ? (
                      <span className="leverage-badge">{t.leverage}x</span>
                    ) : (
                      '--'
                    )}
                  </td>
                  <td>
                    <PnlCell value={t.closed_pnl} />
                  </td>
                  <td>
                    {t.fee != null ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        ${Math.abs(t.fee).toFixed(2)}
                        {t.is_taker != null && (
                          <span className="taker-badge" title={t.is_taker ? 'Taker' : 'Maker'}>
                            {t.is_taker ? ' T' : ' M'}
                          </span>
                        )}
                      </span>
                    ) : '--'}
                  </td>
                  <td>
                    <a
                      className="addr"
                      href={`${HL_EXPLORER}/explorer/address/${t.whale_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t.whale_address}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {shortAddr(t.whale_address)}
                    </a>
                    {t.whale_label && <span className="whale-label">{t.whale_label}</span>}
                    {t._isNewWhale && <span className="new-whale-badge">New</span>}
                  </td>
                  <td>
                    {t.hash ? (
                      <a
                        className="link-btn"
                        href={`${HL_EXPLORER}/explorer/tx/${t.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on Hyperliquid Explorer"
                      >
                        TX
                      </a>
                    ) : '--'}
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

function SortIndicator({ column, active, dir }) {
  const isActive = column === active;
  return (
    <span className={`sort-indicator ${isActive ? 'sort-active' : ''}`}>
      {isActive ? (dir === 'ASC' ? '\u25B2' : '\u25BC') : '\u25B4'}
    </span>
  );
}

function PnlCell({ value }) {
  if (value == null) return <span>--</span>;
  const num = Number(value);
  if (num === 0) return <span style={{ color: 'var(--text-muted)' }}>$0</span>;
  const color = num > 0 ? 'var(--green)' : 'var(--red)';
  const prefix = num > 0 ? '+' : '';
  return (
    <span style={{ color, fontWeight: 600, fontSize: 12 }}>
      {prefix}${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );
}

function dirClass(dir) {
  if (!dir) return '';
  const d = dir.toLowerCase();
  if (d.includes('open') && d.includes('long')) return 'dir-open-long';
  if (d.includes('open') && d.includes('short')) return 'dir-open-short';
  if (d.includes('close') && d.includes('long')) return 'dir-close-long';
  if (d.includes('close') && d.includes('short')) return 'dir-close-short';
  if (d === 'buy') return 'dir-open-long';
  if (d === 'sell') return 'dir-open-short';
  return '';
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
