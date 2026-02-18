const WebSocket = require('ws');
const https = require('https');

const API_BASE = 'https://api.hyperliquid.xyz';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';

// --- REST helpers ---

function postInfo(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + '/info');
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getMeta() {
  return postInfo({ type: 'meta' });
}

async function getSpotMeta() {
  return postInfo({ type: 'spotMeta' });
}

async function getAllMids() {
  return postInfo({ type: 'allMids' });
}

async function getRecentTrades(coin) {
  return postInfo({ type: 'recentTrades', coin });
}

async function getUserFills(user) {
  return postInfo({ type: 'userFills', user, aggregateByTime: true });
}

async function getClearinghouseState(user) {
  return postInfo({ type: 'clearinghouseState', user });
}

async function getSpotClearinghouseState(user) {
  return postInfo({ type: 'spotClearinghouseState', user });
}

// --- WebSocket client ---

class HyperliquidWS {
  constructor() {
    this.ws = null;
    this.subscriptions = new Map();
    this.handlers = new Map(); // channel -> [callbacks]
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.shouldReconnect = true;
    this.pingInterval = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
        this.ws.terminate();
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        console.log('[HL-WS] Connected to Hyperliquid');
        this.reconnectDelay = 1000;
        this._resubscribe();
        this._startPing();
        resolve();
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this._handleMessage(msg);
        } catch (e) {
          console.error('[HL-WS] Parse error:', e.message);
        }
      });

      this.ws.on('close', (code) => {
        clearTimeout(timeout);
        this._stopPing();
        console.log(`[HL-WS] Disconnected (code=${code})`);
        if (this.shouldReconnect) {
          console.log(`[HL-WS] Reconnecting in ${this.reconnectDelay}ms...`);
          setTimeout(() => this.connect().catch(() => {}), this.reconnectDelay);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[HL-WS] Error:', err.message);
      });
    });
  }

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, 15000);
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  _resubscribe() {
    for (const [, sub] of this.subscriptions) {
      this._send({ method: 'subscribe', subscription: sub });
    }
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _handleMessage(msg) {
    if (msg.channel === 'subscriptionResponse') return;
    if (msg.channel === 'pong') return;

    const channel = msg.channel;
    const callbacks = this.handlers.get(channel);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(msg.data);
        } catch (e) {
          console.error(`[HL-WS] Handler error on ${channel}:`, e.message);
        }
      }
    }
  }

  subscribeTrades(coin, callback) {
    const key = `trades:${coin}`;
    const sub = { type: 'trades', coin };
    this.subscriptions.set(key, sub);

    if (!this.handlers.has('trades')) {
      this.handlers.set('trades', []);
    }
    // Wrap callback to filter by coin
    const wrappedCb = (data) => {
      if (Array.isArray(data)) {
        const filtered = data.filter((t) => t.coin === coin);
        if (filtered.length > 0) callback(filtered);
      }
    };
    this.handlers.get('trades').push(wrappedCb);
    this._send({ method: 'subscribe', subscription: sub });
    return key;
  }

  subscribeUserFills(user, callback) {
    const key = `userFills:${user}`;
    const sub = { type: 'userFills', user };
    this.subscriptions.set(key, sub);

    if (!this.handlers.has('userFills')) {
      this.handlers.set('userFills', []);
    }
    this.handlers.get('userFills').push(callback);
    this._send({ method: 'subscribe', subscription: sub });
    return key;
  }

  unsubscribe(key) {
    const sub = this.subscriptions.get(key);
    if (sub) {
      this._send({ method: 'unsubscribe', subscription: sub });
      this.subscriptions.delete(key);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this._stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = {
  postInfo,
  getMeta,
  getSpotMeta,
  getAllMids,
  getRecentTrades,
  getUserFills,
  getClearinghouseState,
  getSpotClearinghouseState,
  HyperliquidWS,
};
