import React, { useState, useEffect } from 'react';
import * as api from '../api';

const HL_EXPLORER = 'https://app.hyperliquid.xyz';

export default function WhalesView() {
  const [whales, setWhales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('total_volume');
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [selectedWhale, setSelectedWhale] = useState(null);
  const [whaleTrades, setWhaleTrades] = useState([]);
  const [whalePositions, setWhalePositions] = useState(null);
  const [editLabel, setEditLabel] = useState('');

  useEffect(() => {
    loadWhales();
  }, [sort, trackedOnly]);

  async function loadWhales() {
    setLoading(true);
    try {
      const data = await api.getWhales({ sort, tracked_only: trackedOnly, limit: 200 });
      setWhales(data);
    } catch (e) {
      console.error('Failed to load whales:', e);
    }
    setLoading(false);
  }

  async function openWhale(whale) {
    setSelectedWhale(whale);
    setEditLabel(whale.label || '');
    try {
      const [freshWhale, trades, positions] = await Promise.all([
        api.getWhale(whale.address),
        api.getTrades({ whale_address: whale.address, limit: 50 }),
        api.getWhalePositions(whale.address).catch(() => null),
      ]);
      if (freshWhale) setSelectedWhale(freshWhale);
      setWhaleTrades(trades);
      setWhalePositions(positions);
    } catch (e) {
      console.error('Failed to load whale detail:', e);
    }
  }

  async function toggleTracking(whale, e) {
    e.stopPropagation();
    try {
      await api.updateWhale(whale.address, { is_tracked: !whale.is_tracked });
      setWhales((prev) =>
        prev.map((w) =>
          w.address === whale.address ? { ...w, is_tracked: w.is_tracked ? 0 : 1 } : w
        )
      );
    } catch (e) {
      console.error('Failed to toggle tracking:', e);
    }
  }

  async function saveLabel() {
    if (!selectedWhale) return;
    try {
      await api.updateWhale(selectedWhale.address, { label: editLabel });
      setSelectedWhale((w) => ({ ...w, label: editLabel }));
      setWhales((prev) =>
        prev.map((w) => (w.address === selectedWhale.address ? { ...w, label: editLabel } : w))
      );
    } catch (e) {
      console.error('Failed to save label:', e);
    }
  }

  return (
    <div>
      <div className="filter-bar">
        <div className="filter-group">
          <label>Sort by</label>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="total_volume">Total Volume</option>
            <option value="last_seen">Last Active</option>
            <option value="trade_count">Trade Count</option>
            <option value="win_ratio">Win Ratio</option>
            <option value="first_seen">First Seen</option>
          </select>
        </div>
        <div className="filter-group">
          <label>&nbsp;</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={trackedOnly}
              onChange={(e) => setTrackedOnly(e.target.checked)}
            />
            Tracked only
          </label>
        </div>
      </div>

      {loading && <div className="empty-state"><p>Loading whales...</p></div>}

      <div className="whale-grid">
        {whales.map((w) => (
          <div key={w.address} className="whale-card" onClick={() => openWhale(w)}>
            <div className="whale-card-header">
              <div>
                <a
                  className="whale-card-addr"
                  href={`${HL_EXPLORER}/explorer/address/${w.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {shortAddr(w.address)}
                </a>
                {w.label && <span className="whale-label">{w.label}</span>}
              </div>
              <button
                className={`track-toggle ${w.is_tracked ? 'tracked' : 'untracked'}`}
                onClick={(e) => toggleTracking(w, e)}
              >
                {w.is_tracked ? 'Tracked' : 'Untracked'}
              </button>
            </div>
            <div className="whale-card-stats">
              <div className="whale-stat">
                Total Volume
                <span>${formatCompact(w.total_volume)}</span>
              </div>
              <div className="whale-stat">
                Trades
                <span>{w.trade_count}</span>
              </div>
              <div className="whale-stat">
                Win Ratio
                <span><WinRatio ratio={w.win_ratio} wins={w.win_count} total={w.close_count} /></span>
              </div>
              <div className="whale-stat">
                Last Active
                <span>{formatDate(w.last_seen)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {whales.length === 0 && !loading && (
        <div className="empty-state">
          <h3>No whales detected yet</h3>
          <p>The scanner is monitoring for large trades. Whales will appear here once detected.</p>
        </div>
      )}

      {/* Whale detail modal */}
      {selectedWhale && (
        <div className="modal-overlay" onClick={() => setSelectedWhale(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              <a
                className="whale-card-addr"
                href={`${HL_EXPLORER}/explorer/address/${selectedWhale.address}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {selectedWhale.address}
              </a>
              <button className="modal-close" onClick={() => setSelectedWhale(null)}>
                &times;
              </button>
            </h2>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Label:</label>
                <input
                  className="editable-label"
                  placeholder="Add a label..."
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onBlur={saveLabel}
                  onKeyDown={(e) => e.key === 'Enter' && saveLabel()}
                />
              </div>
              <div className="whale-card-stats" style={{ marginBottom: 12 }}>
                <div className="whale-stat">
                  Total Volume
                  <span>${formatCompact(selectedWhale.total_volume)}</span>
                </div>
                <div className="whale-stat">
                  Trades
                  <span>{selectedWhale.trade_count}</span>
                </div>
                <div className="whale-stat">
                  Win Ratio
                  <span><WinRatio ratio={selectedWhale.win_ratio} wins={selectedWhale.win_count} total={selectedWhale.close_count} /></span>
                </div>
              </div>
            </div>

            {/* Positions */}
            {whalePositions?.assetPositions?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Current Positions
                </h3>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Coin</th>
                        <th>Side</th>
                        <th>Size</th>
                        <th>Entry</th>
                        <th>Unrealized PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whalePositions.assetPositions.map((p) => {
                        const pos = p.position;
                        const size = parseFloat(pos.szi);
                        const isLong = size > 0;
                        return (
                          <tr key={pos.coin}>
                            <td style={{ fontWeight: 600 }}>{pos.coin}</td>
                            <td className={isLong ? 'side-buy' : 'side-sell'}>
                              {isLong ? 'LONG' : 'SHORT'}
                            </td>
                            <td>{Math.abs(size).toLocaleString()}</td>
                            <td>${formatPrice(parseFloat(pos.entryPx))}</td>
                            <td
                              style={{
                                color:
                                  parseFloat(pos.unrealizedPnl) >= 0
                                    ? 'var(--green)'
                                    : 'var(--red)',
                                fontWeight: 600,
                              }}
                            >
                              ${Number(pos.unrealizedPnl).toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent trades */}
            <h3 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
              Recent Trades
            </h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Pair</th>
                    <th>Side</th>
                    <th>Direction</th>
                    <th>Notional</th>
                    <th>Lev</th>
                    <th>PnL</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {whaleTrades.map((t, i) => (
                    <tr key={t.tid || i}>
                      <td>{formatDateTime(t.time)}</td>
                      <td style={{ fontWeight: 600 }}>{t.coin}</td>
                      <td className={t.side === 'B' ? 'side-buy' : 'side-sell'}>
                        {t.side === 'B' ? 'BUY' : 'SELL'}
                      </td>
                      <td>
                        {t.direction ? (
                          <span className={`dir-badge ${dirClass(t.direction)}`}>
                            {t.direction}
                          </span>
                        ) : '--'}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        ${Number(t.notional).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td>
                        {t.leverage ? <span className="leverage-badge">{t.leverage}x</span> : '--'}
                      </td>
                      <td>
                        {t.closed_pnl != null && t.closed_pnl !== 0 ? (
                          <span
                            style={{
                              color: t.closed_pnl > 0 ? 'var(--green)' : 'var(--red)',
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {t.closed_pnl > 0 ? '+' : ''}$
                            {Number(t.closed_pnl).toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>--</span>
                        )}
                      </td>
                      <td>
                        {t.hash ? (
                          <a
                            className="link-btn"
                            href={`${HL_EXPLORER}/explorer/tx/${t.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            TX
                          </a>
                        ) : '--'}
                      </td>
                    </tr>
                  ))}
                  {whaleTrades.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No trades recorded yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WinRatio({ ratio, wins, total }) {
  if (ratio == null || total === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>--</span>;
  }
  const color = ratio >= 50 ? 'var(--green)' : 'var(--red)';
  return (
    <span title={`${wins}W / ${total - wins}L (${total} closed trades)`}>
      <span style={{ color, fontWeight: 600 }}>{ratio}%</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>
        {wins}/{total}
      </span>
    </span>
  );
}

function shortAddr(addr) {
  if (!addr) return '-';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatCompact(num) {
  if (!num) return '0';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return Number(num).toFixed(0);
}

function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

function formatPrice(p) {
  if (!p) return '-';
  if (p >= 1000) return Number(p).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return Number(p).toFixed(4);
  return Number(p).toPrecision(4);
}
