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
  }

  async start() {
    if (this.running) return;
    this.running = true;

    console.log('[Scanner] Starting whale scanner...');

    // Load mid prices for notional calculation
    await this._refreshPrices();
    this.priceRefreshInterval = setInterval(() => this._refreshPrices(), 30000);

    // Prune old trades every 10 minutes
    this.pruneInterval = setInterval(() => {
      const pruned = db.pruneOldTrades();
      if (pruned > 0) console.log(`[Scanner] Pruned ${pruned} old trades`);
    }, 10 * 60 * 1000);

    // Connect WebSocket
    await this.ws.connect();

    // Subscribe to configured coins
    this._subscribeCoins();

    console.log('[Scanner] Whale scanner running');
  }

  _subscribeCoins() {
    const coinsStr = db.getSetting('monitored_coins') || 'BTC,ETH,SOL';
    const coins = coinsStr
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    // Unsubscribe removed coins
    for (const coin of this.subscribedCoins) {
      if (!coins.includes(coin)) {
        this.ws.unsubscribe(`trades:${coin}`);
      }
    }

    // Subscribe new coins
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

      // Skip trades below minimum notional filter
      if (notional < minNotional) continue;

      const buyer = trade.users ? trade.users[0] : null;
      const seller = trade.users ? trade.users[1] : null;

      // Determine which side is the whale (or both)
      const whaleAddresses = [];

      if (buyer && notional >= whaleThreshold) {
        whaleAddresses.push(buyer);
      }
      if (seller && notional >= whaleThreshold) {
        whaleAddresses.push(seller);
      }

      // If trade is above min_notional but below whale_threshold,
      // still check if buyer/seller is a known tracked whale
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

      // Process each whale in this trade
      for (const whaleAddr of whaleAddresses) {
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

        db.insertTrade(tradeRecord);

        const whale = db.getWhale(whaleAddr);

        // Broadcast to connected clients
        this.broadcast({
          type: isNew ? 'new_whale_trade' : 'whale_trade',
          trade: {
            ...tradeRecord,
            whale_label: whale ? whale.label : null,
          },
          whale: whale,
        });

        if (isNew) {
          console.log(
            `[Scanner] NEW WHALE: ${whaleAddr.slice(0, 10)}... | ${trade.coin} | $${notional.toLocaleString()}`
          );
        }
      }
    }
  }

  stop() {
    this.running = false;
    if (this.priceRefreshInterval) clearInterval(this.priceRefreshInterval);
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    this.ws.disconnect();
    console.log('[Scanner] Stopped');
  }
}

module.exports = WhaleScanner;
