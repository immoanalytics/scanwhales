const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const db = require('./db');
const hl = require('./hyperliquid');
const WhaleScanner = require('./scanner');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// --- Client WebSocket connections ---
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// --- Scanner ---
const scanner = new WhaleScanner(broadcast);

// --- REST API ---

// Stats overview
app.get('/api/stats', (req, res) => {
  try {
    res.json(db.getStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Trades
app.get('/api/trades', (req, res) => {
  try {
    const { limit, offset, coin, whale_address, min_notional, side, since, direction, sort_by, sort_dir } = req.query;
    const trades = db.getTrades({
      limit: Math.min(parseInt(limit) || 100, 500),
      offset: parseInt(offset) || 0,
      coin: coin || null,
      whale_address: whale_address || null,
      min_notional: min_notional ? parseFloat(min_notional) : null,
      side: side || null,
      since: since ? parseInt(since) : null,
      direction: direction || null,
      sort_by: sort_by || 'time',
      sort_dir: sort_dir || 'DESC',
    });
    res.json(trades);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Whales list
app.get('/api/whales', (req, res) => {
  try {
    const { limit, offset, tracked_only, sort } = req.query;
    const whales = db.getWhales({
      limit: Math.min(parseInt(limit) || 100, 500),
      offset: parseInt(offset) || 0,
      tracked_only: tracked_only === 'true',
      sort: sort || 'total_volume',
    });
    res.json(whales);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single whale
app.get('/api/whales/:address', (req, res) => {
  try {
    const whale = db.getWhale(req.params.address);
    if (!whale) return res.status(404).json({ error: 'Whale not found' });
    res.json(whale);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update whale (label, tracking, notes)
app.patch('/api/whales/:address', (req, res) => {
  try {
    const { label, is_tracked, notes } = req.body;
    db.updateWhale(req.params.address, { label, is_tracked, notes });
    const whale = db.getWhale(req.params.address);
    res.json(whale);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Whale's Hyperliquid positions (live from API)
app.get('/api/whales/:address/positions', async (req, res) => {
  try {
    const state = await hl.getClearinghouseState(req.params.address);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Settings
app.get('/api/settings', (req, res) => {
  try {
    const keys = ['min_notional', 'monitored_coins', 'whale_threshold', 'max_trades_kept'];
    const settings = {};
    for (const key of keys) {
      settings[key] = db.getSetting(key);
    }
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    const allowed = ['min_notional', 'monitored_coins', 'whale_threshold', 'max_trades_kept'];
    for (const [key, value] of Object.entries(req.body)) {
      if (allowed.includes(key)) {
        db.setSetting(key, value);
      }
    }
    // Reload coin subscriptions if coins changed
    if (req.body.monitored_coins) {
      scanner.reloadCoins();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Available coins (from Hyperliquid meta)
app.get('/api/coins', async (req, res) => {
  try {
    const meta = await hl.getMeta();
    const coins = meta.universe.map((c) => c.name);
    res.json(coins);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mid prices
app.get('/api/prices', async (req, res) => {
  try {
    const prices = await hl.getAllMids();
    res.json(prices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Serve React frontend in production ---
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

// --- Start server ---
const server = app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});

// --- WebSocket server for client push ---
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (total: ${clients.size})`);

  // Send current stats on connect
  try {
    ws.send(JSON.stringify({ type: 'stats', data: db.getStats() }));
  } catch (e) {
    // ignore
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (total: ${clients.size})`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// --- Start scanner ---
scanner.start().catch((err) => {
  console.error('[Scanner] Failed to start:', err.message);
  // Retry after delay
  setTimeout(() => scanner.start().catch(console.error), 5000);
});

// --- Graceful shutdown ---
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

function shutdown() {
  console.log('[Server] Shutting down...');
  scanner.stop();
  wss.close();
  server.close();
  db.close();
  process.exit(0);
}
