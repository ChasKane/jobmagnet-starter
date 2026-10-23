const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA, MIGRATE } = require('./schema');
const api = require('./api');

const ROOT = path.join(__dirname, '..', '..');
const BUSY_TIMEOUT_MS = 5000;
const BUSY_RETRIES = 4;
const SQLITE_BUSY = 5;

let db = null;
let dbPath = null;
const txStmts = [];

function defaultPath() {
  return process.env.MAGNET_DB || path.join(ROOT, 'knowledge', 'magnet.sqlite');
}

function isBusy(err) {
  if (!err) return false;
  if (Number(err.errcode) === SQLITE_BUSY) return true;
  return /database is locked/i.test(String(err.errstr || err.message || ''));
}

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withBusyRetry(fn) {
  let last;
  for (let i = 0; i < BUSY_RETRIES; i++) {
    try {
      return fn();
    } catch (err) {
      last = err;
      if (!isBusy(err) || i === BUSY_RETRIES - 1) throw err;
      sleepSync(50 * (i + 1));
    }
  }
  throw last;
}

function openDatabase(dest) {
  if (dest === ':memory:') return new DatabaseSync(dest);
  try {
    return new DatabaseSync(dest, { timeout: BUSY_TIMEOUT_MS });
  } catch (_) {
    return new DatabaseSync(dest);
  }
}

function configure(conn, dest) {
  if (dest !== ':memory:') {
    conn.exec('PRAGMA journal_mode = WAL');
    conn.exec('PRAGMA synchronous = NORMAL');
  }
  conn.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
}

function makeDriver(conn) {
  return {
    query(sql, params = []) {
      return withBusyRetry(() => {
        const rows = conn.prepare(sql).all(...params);
        txStmts.push({ sql, n: rows.length });
        return rows.map(api.wrapRow);
      });
    },
    queryOne(sql, params = []) {
      return withBusyRetry(() => {
        const row = conn.prepare(sql).get(...params);
        txStmts.push({ sql, n: row ? 1 : 0 });
        return api.wrapRow(row);
      });
    },
    exec(sql, params = []) {
      return withBusyRetry(() => {
        if (!params.length && /;\s*\n/.test(sql) && /^\s*CREATE|PRAGMA|ALTER/i.test(sql)) {
          conn.exec(sql);
          return { changes: 0 };
        }
        const info = conn.prepare(sql).run(...params);
        txStmts.push({ sql, n: Number(info && info.changes) || 0 });
        return info;
      });
    },
    execScript(sql) {
      withBusyRetry(() => conn.exec(sql));
    },
    transaction(fn) {
      return withBusyRetry(() => {
        txStmts.length = 0;
        conn.exec('BEGIN IMMEDIATE');
        try {
          const result = fn();
          conn.exec('COMMIT');
          const stmts = txStmts.slice();
          txStmts.length = 0;
          return { result, stmts };
        } catch (err) {
          try {
            conn.exec('ROLLBACK');
          } catch (_) {}
          txStmts.length = 0;
          throw err;
        }
      });
    },
    close() {
      try {
        conn.close();
      } catch (_) {}
    },
    path: dbPath,
  };
}

function open(file) {
  const { storeMode } = require('./mode');
  if (storeMode() === 'supabase') {
    if (db) close();
    return require('./sql-rest').open();
  }
  const dest = file || defaultPath();
  if (db && dbPath === dest && api.getDriver()) return exposed();
  close();
  if (dest !== ':memory:') fs.mkdirSync(path.dirname(dest), { recursive: true });
  db = openDatabase(dest);
  configure(db, dest);
  dbPath = dest;
  const driver = makeDriver(db);
  api.applySchema(driver, SCHEMA, MIGRATE);
  api.setDriver(driver);
  return exposed();
}

function close() {
  api.close();
  db = null;
  dbPath = null;
}

function exposed() {
  return {
    query: api.query,
    queryOne: api.queryOne,
    exec: api.exec,
    execScript: api.execScript,
    transaction: api.transaction,
    close,
    path: dbPath,
  };
}

module.exports = {
  open,
  close,
  query: api.query,
  queryAsync: api.queryAsync,
  queryOne: api.queryOne,
  queryOneAsync: api.queryOneAsync,
  exec: api.exec,
  execAsync: api.execAsync,
  execScript: api.execScript,
  transaction: api.transaction,
  defaultPath,
  setDriver: api.setDriver,
  getDriver: api.getDriver,
};
