const { SCHEMA, MIGRATE } = require('../../../lib/store/schema');
const { applySchema, wrapRow } = require('../../../lib/store/api');

function createExpoDriver(db) {
  return {
    query(sql, params = []) {
      const rows = db.getAllSync ? db.getAllSync(sql, params) : [];
      return (rows || []).map(wrapRow);
    },
    queryOne(sql, params = []) {
      const row = db.getFirstSync ? db.getFirstSync(sql, params) : null;
      return wrapRow(row);
    },
    exec(sql, params = []) {
      if ((!params || !params.length) && /CREATE|PRAGMA|ALTER/i.test(sql)) {
        if (db.execSync) db.execSync(sql);
        else db.runSync(sql);
        return { changes: 0 };
      }
      return db.runSync ? db.runSync(sql, params) : { changes: 0 };
    },
    execScript(sql) {
      if (db.execSync) db.execSync(sql);
      else db.runSync(sql);
    },
    close() {
      try {
        if (db.closeSync) db.closeSync();
      } catch (_) {}
    },
  };
}

function openMobileSqlite() {
  let SQLite;
  try {
    SQLite = require('expo-sqlite');
  } catch (err) {
    throw new Error('expo-sqlite is not installed');
  }
  const db = SQLite.openDatabaseSync('magnet.sqlite');
  const driver = createExpoDriver(db);
  applySchema(driver, SCHEMA, MIGRATE);
  return driver;
}

module.exports = { createExpoDriver, openMobileSqlite };
