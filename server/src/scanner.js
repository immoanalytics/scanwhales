const db = require('./db');
const hl = require('./hyperliquid');

class WhaleScanner {
  constructor(broadcastFn) {
    this.ws = new hl.HyperliquidWS();
    this.broadcast = broadcastFn || (() => {});
    this.subscribedCoins = [];
    this.midPrices = {};
    this.priceRefreshInterval = null;
    this.pruneInterval = null;
    this.running = false;
    // In-memory dedup: Set of "tid:whale_address" seen recently
    this.recentTids = new Set();
    this.tidCleanupInterval = null;
    // Enrichment queue: batch whale addresses to enrich
    this.enrichQueue = new Map(); // whale_address -> Set<tid>
    this.enrichTimer = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    console.log('[Scanner] Starting whale scanner...');

    await this._refreshPrices();
    this.priceRefreshInterval = setInterval(() => this._refreshPrices(), 30000);

    this.pruneInterval = setInterval(() => {
      const pruned = db.pruneOldTrades();
      if (pruned > 0) console.log(`[Scanner] Pruned ${pruned} old trades`);
    }, 10 * 60 * 1000);

    // Clean dedup cache every 5 minutes (keep last ~10k entries)
    this.tidCleanupInterval = setInterval(() => {
      if (this.recentTids.size > 10000) {
        const arr = [...this.recentTids];
        this.recentTids = new Set(arr.slice(arr.length - 5000));
      }
    }, 5 * 60 * 1000);

    await this.ws.connect();
    this._subscribeCoins();

    console.log('[Scanner] Whale scanner running');
  }

  _subscribeCoins() {
    const coinsStr = db.getSetting('monitored_coins') || 'BTC,ETH,SOL';
    const coins = coinsStr
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    for (const coin of this.subscribedCoins) {
      if (!coins.includes(coin)) {
        this.ws.unsubscribe(`trades:${coin}`);
      }
    }

    for (const coin of coins) {
      if (!this.subscribedCoins.includes(coin)) {
        this.ws.subscribeTrades(coin, (trades) => this._onTrades(trades));
        console.log(`[Scanner] Subscribed to ${coin} trades`);
      }
    }

    this.subscribedCoins = coins;
  }

  reloadCoins() {
    this._subscribeCoins();
  }

  async _refreshPrices() {
    try {
      this.midPrices = await hl.getAllMids();
    } catch (e) {
      console.error('[Scanner] Failed to refresh prices:', e.message);
    }
  }

  _onTrades(trades) {
    const minNotional = parseFloat(db.getSetting('min_notional') || '50000');
    const whaleThreshold = parseFloat(db.getSetting('whale_threshold') || '100000');

    for (const trade of trades) {
      const price = parseFloat(trade.px);
      const size = parseFloat(trade.sz);
      const notional = price * size;

      if (notional < minNotional) continue;

      const buyer = trade.users ? trade.users[0] : null;
      const seller = trade.users ? trade.users[1] : null;

      const whaleAddresses = [];

      if (buyer && notional >= whaleThreshold) {
        whaleAddresses.push(buyer);
      }
      if (seller && notional >= whaleThreshold) {
        whaleAddresses.push(seller);
      }

      if (whaleAddresses.length === 0) {
        if (buyer) {
          const existing = db.getWhale(buyer);
          if (existing && existing.is_tracked) whaleAddresses.push(buyer);
        }
        if (seller && seller !== buyer) {
          const existing = db.getWhale(seller);
          if (existing && existing.is_tracked) whaleAddresses.push(seller);
        }
      }

      if (whaleAddresses.length === 0) continue;

      for (const whaleAddr of whaleAddresses) {
        // In-memory dedup
        const dedupKey = `${trade.tid}:${whaleAddr}`;
        if (this.recentTids.has(dedupKey)) continue;
        this.recentTids.add(dedupKey);

        const isNew = db.upsertWhale(whaleAddr, trade.time, notional);

        const tradeRecord = {
          coin: trade.coin,
          side: whaleAddr === buyer ? 'B' : 'A',
          price,
          size,
          notional,
          time: trade.time,
          hash: trade.hash || null,
          tid: trade.tid || null,
          buyer,
          seller,
          whale_address: whaleAddr,
        };

        const result = db.insertTrade(tradeRecord);
        // If INSERT OR IGNORE skipped it (changes === 0), skip broadcast
        if (result.changes === 0) continue;

        const whale = db.getWhale(whaleAddr);

        this.broadcast({
          type: isNew ? 'new_whale_trade' : 'whale_trade',
          trade: {
            ...tradeRecord,
            whale_label: whale ? whale.label : null,
          },
          whale: whale,
        });

        // Queue for async enrichment
        this._queueEnrich(whaleAddr, trade.tid);

        if (isNew) {
          console.log(
            `[Scanner] NEW WHALE: ${whaleAddr.slice(0, 10)}... | ${trade.coin} | $${notional.toLocaleString()}`
          );
        }
      }
    }
  }

  _queueEnrich(whaleAddr, tid) {
    if (!this.enrichQueue.has(whaleAddr)) {
      this.enrichQueue.set(whaleAddr, new Set());
    }
    this.enrichQueue.get(whaleAddr).add(tid);

    // Debounce: process enrichment queue every 3 seconds
    if (!this.enrichTimer) {
      this.enrichTimer = setTimeout(() => {
        this.enrichTimer = null;
        this._processEnrichQueue();
      }, 3000);
    }
  }

  async _processEnrichQueue() {
    const queue = new Map(this.enrichQueue);
    this.enrichQueue.clear();

    for (const [whaleAddr, tids] of queue) {
      try {
        // Fetch recent fills for this whale
        const fills = await hl.getUserFills(whaleAddr);
        if (!Array.isArray(fills)) continue;

        // Also fetch clearinghouse state for leverage info
        let leverageMap = {};
        try {
          const state = await hl.getClearinghouseState(whaleAddr);
          if (state && state.assetPositions) {
            for (const ap of state.assetPositions) {
              const pos = ap.position;
              if (pos && pos.coin && pos.leverage) {
                leverageMap[pos.coin] = parseFloat(pos.leverage.value || pos.leverage);
              }
            }
          }
        } catch (e) {
          // leverage is optional, don't fail
        }

        // Match fills by tid
        const fillsByTid = new Map();
        for (const fill of fills) {
          fillsByTid.set(fill.tid, fill);
        }

        for (const tid of tids) {
          const fill = fillsByTid.get(tid);
          if (!fill) continue;

          const enrichment = {
            direction: fill.dir || null,
            closed_pnl: fill.closedPnl ? parseFloat(fill.closedPnl) : 0,
            fee: fill.fee ? parseFloat(fill.fee) : 0,
            is_taker: fill.crossed === true,
            leverage: leverageMap[fill.coin] || null,
          };

          db.enrichTrade(tid, whaleAddr, enrichment);

          // Broadcast the enrichment update to clients
          this.broadcast({
            type: 'trade_enriched',
            tid,
            whale_address: whaleAddr,
            enrichment,
          });
        }
      } catch (e) {
        console.error(`[Scanner] Enrichment failed for ${whaleAddr.slice(0, 10)}:`, e.message);
      }
    }
  }

  stop() {
    this.running = false;
    if (this.priceRefreshInterval) clearInterval(this.priceRefreshInterval);
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    if (this.tidCleanupInterval) clearInterval(this.tidCleanupInterval);
    if (this.enrichTimer) clearTimeout(this.enrichTimer);
    this.ws.disconnect();
    console.log('[Scanner] Stopped');
  }
}

module.exports = WhaleScanner;
