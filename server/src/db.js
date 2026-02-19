const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'scanwhales.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whales (
      address TEXT PRIMARY KEY,
      label TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      total_volume REAL DEFAULT 0,
      trade_count INTEGER DEFAULT 0,
      is_tracked INTEGER DEFAULT 1,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coin TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      size REAL NOT NULL,
      notional REAL NOT NULL,
      time INTEGER NOT NULL,
      hash TEXT,
      tid INTEGER,
      buyer TEXT,
      seller TEXT,
      whale_address TEXT,
      direction TEXT,
      closed_pnl REAL,
      fee REAL,
      is_taker INTEGER,
      leverage REAL,
      FOREIGN KEY (whale_address) REFERENCES whales(address)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_dedup ON trades(tid, whale_address);
    CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(time DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_whale ON trades(whale_address);
    CREATE INDEX IF NOT EXISTS idx_trades_coin ON trades(coin);
    CREATE INDEX IF NOT EXISTS idx_trades_notional ON trades(notional DESC);
    CREATE INDEX IF NOT EXISTS idx_whales_volume ON whales(total_volume DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate: add new columns if they don't exist (safe for existing DBs)
  const cols = db.prepare("PRAGMA table_info(trades)").all().map((c) => c.name);
  if (!cols.includes('direction')) {
    db.exec('ALTER TABLE trades ADD COLUMN direction TEXT');
  }
  if (!cols.includes('closed_pnl')) {
    db.exec('ALTER TABLE trades ADD COLUMN closed_pnl REAL');
  }
  if (!cols.includes('fee')) {
    db.exec('ALTER TABLE trades ADD COLUMN fee REAL');
  }
  if (!cols.includes('is_taker')) {
    db.exec('ALTER TABLE trades ADD COLUMN is_taker INTEGER');
  }
  if (!cols.includes('leverage')) {
    db.exec('ALTER TABLE trades ADD COLUMN leverage REAL');
  }

  // Insert default settings if not present
  const defaults = {
    min_notional: '50000',
    monitored_coins: 'BTC,ETH,SOL,DOGE,XRP,AVAX,LINK,ARB,OP,SUI,APT,WIF,PEPE,ONDO,HYPE',
    whale_threshold: '500000',
    max_trades_kept: '50000',
  };

  const upsert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    upsert.run(key, value);
  }
}

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, String(value));
}

function insertTrade(trade) {
  return getDb()
    .prepare(
      `INSERT OR IGNORE INTO trades (coin, side, price, size, notional, time, hash, tid, buyer, seller, whale_address, direction, closed_pnl, fee, is_taker, leverage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      trade.coin,
      trade.side,
      trade.price,
      trade.size,
      trade.notional,
      trade.time,
      trade.hash || null,
      trade.tid || null,
      trade.buyer || null,
      trade.seller || null,
      trade.whale_address || null,
      trade.direction || null,
      trade.closed_pnl ?? null,
      trade.fee ?? null,
      trade.is_taker ?? null,
      trade.leverage ?? null
    );
}

function enrichTrade(tid, whaleAddress, enrichment) {
  const fields = [];
  const values = [];
  if (enrichment.direction !== undefined) {
    fields.push('direction = ?');
    values.push(enrichment.direction);
  }
  if (enrichment.closed_pnl !== undefined) {
    fields.push('closed_pnl = ?');
    values.push(enrichment.closed_pnl);
  }
  if (enrichment.fee !== undefined) {
    fields.push('fee = ?');
    values.push(enrichment.fee);
  }
  if (enrichment.is_taker !== undefined) {
    fields.push('is_taker = ?');
    values.push(enrichment.is_taker ? 1 : 0);
  }
  if (enrichment.leverage !== undefined) {
    fields.push('leverage = ?');
    values.push(enrichment.leverage);
  }
  if (fields.length === 0) return;
  values.push(tid, whaleAddress);
  getDb()
    .prepare(`UPDATE trades SET ${fields.join(', ')} WHERE tid = ? AND whale_address = ?`)
    .run(...values);
}

function upsertWhale(address, time, notional) {
  const existing = getDb()
    .prepare('SELECT * FROM whales WHERE address = ?')
    .get(address);

  if (existing) {
    getDb()
      .prepare(
        `UPDATE whales
         SET last_seen = MAX(last_seen, ?),
             total_volume = total_volume + ?,
             trade_count = trade_count + 1
         WHERE address = ?`
      )
      .run(time, notional, address);
    return false; // not new
  } else {
    getDb()
      .prepare(
        `INSERT INTO whales (address, first_seen, last_seen, total_volume, trade_count, is_tracked)
         VALUES (?, ?, ?, ?, 1, 1)`
      )
      .run(address, time, time, notional);
    return true; // new whale
  }
}

function getWhales({ limit = 100, offset = 0, tracked_only = false, sort = 'total_volume' } = {}) {
  const validSorts = ['total_volume', 'last_seen', 'trade_count', 'first_seen', 'win_ratio'];
  const sortCol = validSorts.includes(sort) ? sort : 'total_volume';
  const where = tracked_only ? 'WHERE w.is_tracked = 1' : '';

  return getDb()
    .prepare(
      `SELECT w.*,
              COALESCE(s.win_count, 0) as win_count,
              COALESCE(s.close_count, 0) as close_count,
              CASE WHEN COALESCE(s.close_count, 0) > 0
                   THEN ROUND(100.0 * s.win_count / s.close_count, 1)
                   ELSE NULL END as win_ratio
       FROM whales w
       LEFT JOIN (
         SELECT whale_address,
                SUM(CASE WHEN closed_pnl > 0 THEN 1 ELSE 0 END) as win_count,
                COUNT(*) as close_count
         FROM trades
         WHERE closed_pnl IS NOT NULL
         GROUP BY whale_address
       ) s ON w.address = s.whale_address
       ${where}
       ORDER BY CASE WHEN ${sortCol} IS NULL THEN 1 ELSE 0 END, ${sortCol} DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
}

function getWhale(address) {
  return getDb().prepare('SELECT * FROM whales WHERE address = ?').get(address);
}

function getWhaleWithStats(address) {
  return getDb()
    .prepare(
      `SELECT w.*,
              COALESCE(s.win_count, 0) as win_count,
              COALESCE(s.close_count, 0) as close_count,
              CASE WHEN COALESCE(s.close_count, 0) > 0
                   THEN ROUND(100.0 * s.win_count / s.close_count, 1)
                   ELSE NULL END as win_ratio
       FROM whales w
       LEFT JOIN (
         SELECT whale_address,
                SUM(CASE WHEN closed_pnl > 0 THEN 1 ELSE 0 END) as win_count,
                COUNT(*) as close_count
         FROM trades
         WHERE closed_pnl IS NOT NULL AND whale_address = ?
         GROUP BY whale_address
       ) s ON w.address = s.whale_address
       WHERE w.address = ?`
    )
    .get(address, address);
}

function updateWhale(address, updates) {
  const fields = [];
  const values = [];
  if (updates.label !== undefined) {
    fields.push('label = ?');
    values.push(updates.label);
  }
  if (updates.is_tracked !== undefined) {
    fields.push('is_tracked = ?');
    values.push(updates.is_tracked ? 1 : 0);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes);
  }
  if (fields.length === 0) return;
  values.push(address);
  getDb()
    .prepare(`UPDATE whales SET ${fields.join(', ')} WHERE address = ?`)
    .run(...values);
}

function getTrades({
  limit = 100,
  offset = 0,
  coin = null,
  whale_address = null,
  min_notional = null,
  side = null,
  since = null,
  direction = null,
  sort_by = 'time',
  sort_dir = 'DESC',
} = {}) {
  const conditions = [];
  const params = [];

  if (coin) {
    conditions.push('t.coin = ?');
    params.push(coin);
  }
  if (whale_address) {
    conditions.push('t.whale_address = ?');
    params.push(whale_address);
  }
  if (min_notional) {
    conditions.push('t.notional >= ?');
    params.push(min_notional);
  }
  if (side) {
    conditions.push('t.side = ?');
    params.push(side);
  }
  if (since) {
    conditions.push('t.time >= ?');
    params.push(since);
  }
  if (direction) {
    conditions.push('t.direction = ?');
    params.push(direction);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const validSortCols = ['time', 'coin', 'notional', 'price', 'size', 'closed_pnl', 'leverage', 'fee'];
  const sortCol = validSortCols.includes(sort_by) ? sort_by : 'time';
  const dir = sort_dir === 'ASC' ? 'ASC' : 'DESC';

  params.push(limit, offset);

  return getDb()
    .prepare(
      `SELECT t.*, w.label as whale_label
       FROM trades t
       LEFT JOIN whales w ON t.whale_address = w.address
       ${where}
       ORDER BY t.${sortCol} ${dir}
       LIMIT ? OFFSET ?`
    )
    .all(...params);
}

function getStats() {
  const d = getDb();
  const totalWhales = d.prepare('SELECT COUNT(*) as count FROM whales').get().count;
  const trackedWhales = d
    .prepare('SELECT COUNT(*) as count FROM whales WHERE is_tracked = 1')
    .get().count;
  const totalTrades = d.prepare('SELECT COUNT(*) as count FROM trades').get().count;
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const trades24h = d
    .prepare('SELECT COUNT(*) as count FROM trades WHERE time >= ?')
    .get(last24h).count;
  const volume24h = d
    .prepare('SELECT COALESCE(SUM(notional), 0) as vol FROM trades WHERE time >= ?')
    .get(last24h).vol;
  const topCoins = d
    .prepare(
      `SELECT coin, COUNT(*) as count, SUM(notional) as volume
       FROM trades WHERE time >= ?
       GROUP BY coin ORDER BY volume DESC LIMIT 10`
    )
    .all(last24h);

  return { totalWhales, trackedWhales, totalTrades, trades24h, volume24h, topCoins };
}

function pruneOldTrades() {
  const maxKept = parseInt(getSetting('max_trades_kept') || '50000', 10);
  const count = getDb().prepare('SELECT COUNT(*) as count FROM trades').get().count;
  if (count > maxKept) {
    const excess = count - maxKept;
    getDb()
      .prepare(
        `DELETE FROM trades WHERE id IN (SELECT id FROM trades ORDER BY time ASC LIMIT ?)`
      )
      .run(excess);
    return excess;
  }
  return 0;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  getSetting,
  setSetting,
  insertTrade,
  enrichTrade,
  upsertWhale,
  getWhales,
  getWhale,
  getWhaleWithStats,
  updateWhale,
  getTrades,
  getStats,
  pruneOldTrades,
  close,
};
