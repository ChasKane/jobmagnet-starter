/** Injectable SQL driver. Graph and sql-store talk to this, not node:sqlite. */

let driver = null;

function setDriver(next) {
  driver = next || null;
  return driver;
}

function getDriver() {
  return driver;
}

function ensure() {
  if (!driver) throw new Error('Magnet store driver is not open');
  return driver;
}

function query(sql, params = []) {
  return ensure().query(sql, params);
}

function queryAsync(sql, params = []) {
  const drv = ensure();
  if (typeof drv.queryAsync === 'function') return drv.queryAsync(sql, params);
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(drv.query(sql, params));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function queryOne(sql, params = []) {
  return ensure().queryOne(sql, params);
}

function queryOneAsync(sql, params = []) {
  const drv = ensure();
  if (typeof drv.queryOneAsync === 'function') return drv.queryOneAsync(sql, params);
  return queryAsync(sql, params).then((rows) => (Array.isArray(rows) ? rows[0] : rows));
}

function exec(sql, params = []) {
  return ensure().exec(sql, params);
}

function execAsync(sql, params = []) {
  const drv = ensure();
  if (typeof drv.execAsync === 'function') return drv.execAsync(sql, params);
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(drv.exec(sql, params));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function execScript(sql) {
  if (typeof ensure().execScript === 'function') return ensure().execScript(sql);
  return ensure().exec(sql);
}

function transaction(fn) {
  if (typeof ensure().transaction === 'function') return ensure().transaction(fn);
  execScript('BEGIN');
  try {
    const result = fn();
    execScript('COMMIT');
    return { result, stmts: [] };
  } catch (err) {
    try {
      execScript('ROLLBACK');
    } catch (_) {}
    throw err;
  }
}

function close() {
  if (driver && typeof driver.close === 'function') driver.close();
  driver = null;
}

function applySchema(drv, schema, migrate = []) {
  if (!drv) return;
  if (typeof drv.execScript === 'function') drv.execScript(schema);
  else drv.exec(schema);
  for (const sql of migrate || []) {
    try {
      drv.exec(sql);
    } catch (_) {}
  }
}

function wrapRow(row) {
  if (!row) return undefined;
  return { ...row };
}

module.exports = {
  setDriver,
  getDriver,
  query,
  queryAsync,
  queryOne,
  queryOneAsync,
  exec,
  execAsync,
  execScript,
  transaction,
  close,
  applySchema,
  wrapRow,
};
