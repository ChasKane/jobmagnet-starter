/** Sync and async HTTP through one keep-alive worker. Sync waits off the event loop via Atomics. */

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const HEADER = 32;
const MAX = 24 * 1024 * 1024;
const sab = new SharedArrayBuffer(HEADER + MAX);
const meta = new Int32Array(sab, 0, 8);
const bytes = Buffer.from(sab, HEADER);

let worker = null;
let disabled = false;
let seq = 0;
let inflight = 0;
const pending = new Map();

function hold() {
  inflight += 1;
  if (worker && inflight === 1) worker.ref();
}

function release() {
  inflight = Math.max(0, inflight - 1);
  if (worker && inflight === 0) worker.unref();
}

function failWorker(err) {
  const error = err instanceof Error ? err : new Error(String(err || 'rest worker failed'));
  error.code = 'WORKER';
  return error;
}

function dropWorker() {
  const current = worker;
  worker = null;
  if (!current) return;
  try {
    current.terminate();
  } catch (_) {}
}

function ensure() {
  if (disabled) throw failWorker('rest worker disabled');
  if (worker) return worker;
  try {
    worker = new Worker(path.join(__dirname, 'http-worker.js'), {
      workerData: { sab },
      execArgv: ['--max-http-header-size=262144'],
    });
  } catch (err) {
    disabled = true;
    throw failWorker(err && err.message);
  }
  worker.on('message', (msg) => {
    const wait = pending.get(msg.id);
    if (!wait) return;
    pending.delete(msg.id);
    if (msg.ok) wait.resolve(msg);
    else wait.reject(new Error(msg.error || 'rest failed'));
  });
  worker.on('error', (err) => {
    dropWorker();
    for (const wait of pending.values()) wait.reject(err);
    pending.clear();
  });
  worker.unref();
  worker.on('exit', (code) => {
    if (worker) worker = null;
    if (!code) return;
    for (const wait of pending.values()) wait.reject(new Error(`rest worker exited ${code}`));
    pending.clear();
  });
  return worker;
}

function readSync() {
  const status = Atomics.load(meta, 1);
  const bodyLen = Atomics.load(meta, 2);
  const flags = Atomics.load(meta, 3);
  const rangeLen = Atomics.load(meta, 5);
  const range = Buffer.from(bytes.subarray(0, rangeLen)).toString('utf8');
  const raw = Buffer.from(bytes.subarray(rangeLen, rangeLen + bodyLen)).toString('utf8');
  Atomics.store(meta, 0, 0);
  if (flags & 1) throw new Error(raw.slice(0, 240) || 'rest failed');
  const text = flags & 2 ? fs.readFileSync(raw, 'utf8') : raw;
  if (flags & 2) {
    try {
      fs.unlinkSync(raw);
    } catch (_) {}
  }
  return { status, text, contentRange: range };
}

function requestSync(spec) {
  const child = ensure();
  Atomics.store(meta, 0, 1);
  child.postMessage({ kind: 'sync', ...spec });
  let waited;
  try {
    waited = Atomics.wait(meta, 0, 1, 20000);
  } catch (err) {
    disabled = true;
    dropWorker();
    throw failWorker(err && err.message);
  }
  if (Atomics.load(meta, 0) !== 2) {
    dropWorker();
    Atomics.store(meta, 0, 0);
    throw new Error(waited === 'timed-out' ? 'rest timeout' : 'rest failed');
  }
  return readSync();
}

function requestAsync(spec) {
  let child;
  try {
    child = ensure();
  } catch (err) {
    return Promise.reject(err);
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('rest timeout'));
    }, 20000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        release();
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        release();
        reject(err);
      },
    });
    hold();
    try {
      child.postMessage({ kind: 'async', id, ...spec });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      release();
      reject(err);
    }
  });
}

module.exports = { requestSync, requestAsync };
