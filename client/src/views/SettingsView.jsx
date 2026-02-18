import React, { useState, useEffect } from 'react';
import * as api from '../api';

export default function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [availableCoins, setAvailableCoins] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
    api.getCoins().then(setAvailableCoins).catch(console.error);
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      await api.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
    setSaving(false);
  }

  if (!settings) return <div className="empty-state"><p>Loading settings...</p></div>;

  return (
    <div className="settings-panel">
      <div className="setting-group">
        <h3>Trade Detection</h3>
        <div className="setting-row">
          <label>Minimum Notional Value ($)</label>
          <input
            type="number"
            value={settings.min_notional}
            onChange={(e) => setSettings((s) => ({ ...s, min_notional: e.target.value }))}
          />
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Trades below this USD value are ignored entirely.
        </p>
      </div>

      <div className="setting-group">
        <h3>Whale Threshold</h3>
        <div className="setting-row">
          <label>New Whale Detection Threshold ($)</label>
          <input
            type="number"
            value={settings.whale_threshold}
            onChange={(e) => setSettings((s) => ({ ...s, whale_threshold: e.target.value }))}
          />
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Addresses making a single trade above this value are automatically marked as whales.
          Already-tracked whales are monitored at the minimum notional level above.
        </p>
      </div>

      <div className="setting-group">
        <h3>Monitored Pairs</h3>
        <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>Comma-separated coin list</label>
          <textarea
            value={settings.monitored_coins}
            onChange={(e) =>
              setSettings((s) => ({ ...s, monitored_coins: e.target.value.toUpperCase() }))
            }
            placeholder="BTC,ETH,SOL..."
          />
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          WebSocket trade subscriptions will be created for each coin listed here.
          Changes take effect immediately on save.
        </p>
        {availableCoins.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary
              style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer' }}
            >
              Available coins ({availableCoins.length})
            </summary>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: 'var(--text-muted)',
                lineHeight: 1.8,
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {availableCoins.map((c) => (
                <span
                  key={c}
                  onClick={() => {
                    const current = settings.monitored_coins
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (!current.includes(c)) {
                      setSettings((s) => ({
                        ...s,
                        monitored_coins: [...current, c].join(','),
                      }));
                    }
                  }}
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    margin: 2,
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="setting-group">
        <h3>Storage</h3>
        <div className="setting-row">
          <label>Max trades kept in database</label>
          <input
            type="number"
            value={settings.max_trades_kept}
            onChange={(e) => setSettings((s) => ({ ...s, max_trades_kept: e.target.value }))}
          />
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Oldest trades are pruned periodically when this limit is exceeded.
        </p>
      </div>

      <button
        className="btn btn-primary"
        onClick={handleSave}
        disabled={saving}
        style={{ marginTop: 8 }}
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}
