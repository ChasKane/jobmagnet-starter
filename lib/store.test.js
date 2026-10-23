const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `magnet-store-${process.pid}.sqlite`);
process.env.MAGNET_DB = dbFile;
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-s-${process.pid}`);

const { Worker } = require('worker_threads');
const store = require('./store');
const graph = require('./graph');
const { dump } = require('./store/export');

function resetStore() {
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  for (const extra of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(dbFile + extra);
    } catch (_) {}
  }
  store.close();
  store.open(dbFile);
}

test('store query/exec and yaml export', () => {
  resetStore();
  graph.upsertCard({
    employer: 'Peloton',
    claim: 'Converted marketing pages to Page Builder.',
    proof: 'Scoped PB conversion.',
    tags: ['frontend'],
    confidence: 'corroborated',
  });
  const index = graph.cardIndex();
  assert.equal(index.length, 1);
  assert.equal(index[0].employer, 'Peloton');
  const dest = path.join(os.tmpdir(), `magnet-export-${process.pid}`);
  process.env.MAGNET_EXPORT = dest;
  dump();
  assert.ok(fs.existsSync(path.join(dest, 'cards.yaml')));
  store.close();
});

test('store opens files in WAL with a busy timeout', () => {
  resetStore();
  const mode = store.queryOne('PRAGMA journal_mode');
  assert.equal(String((mode && (mode.journal_mode || mode.JOURNAL_MODE)) || '').toLowerCase(), 'wal');
  const timeout = store.queryOne('PRAGMA busy_timeout');
  const ms = Number(timeout && (timeout.busy_timeout ?? timeout.timeout ?? Object.values(timeout)[0]));
  assert.ok(ms >= 5000);
  store.close();
});

test('store waits out a brief exclusive lock from another connection', async () => {
  resetStore();
  store.exec('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    'chatUi',
    '{"ok":1}',
  ]);
  await new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(workerData.file);
      db.exec('BEGIN EXCLUSIVE');
      parentPort.postMessage('held');
      setTimeout(() => {
        db.exec('COMMIT');
        db.close();
        parentPort.postMessage('released');
      }, 120);
      `,
      { eval: true, workerData: { file: dbFile } }
    );
    let wrote = false;
    worker.on('message', (msg) => {
      if (msg !== 'held' || wrote) return;
      wrote = true;
      try {
        store.exec('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
          'chatUi',
          '{"ok":2}',
        ]);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (!wrote) reject(new Error(`lock worker exited ${code}`));
    });
  });
  const row = store.queryOne('SELECT value FROM kv WHERE key = ?', ['chatUi']);
  assert.equal(row.value, '{"ok":2}');
  store.close();
});
