const path = require('path');
const readline = require('readline');
const { spawnNode } = require('./spawn-node');

let child = null;
let seq = 0;
const pending = new Map();
let starting = null;

function write(msg) {
  if (!child || !child.stdin || !child.stdin.writable) throw new Error('agent-host not running');
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function failAll(err) {
  const error = err instanceof Error ? err : new Error(String(err || 'agent-host exit'));
  for (const [, row] of pending) {
    row.reject(error);
  }
  pending.clear();
}

function attach(proc) {
  child = proc;
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    let ev;
    try {
      ev = JSON.parse(text);
    } catch {
      return;
    }
    const row = ev && ev.id != null ? pending.get(ev.id) : null;
    if (!row) return;
    if (ev.op === 'delta' || ev.op === 'tool' || ev.op === 'stage' || ev.op === 'drafts') {
      if (row.onEvent) row.onEvent(ev);
      return;
    }
    pending.delete(ev.id);
    if (ev.op === 'error' && !ev.cancelled) {
      row.reject(new Error(ev.error || 'agent-host error'));
      return;
    }
    row.resolve(ev);
  });
  proc.stderr.on('data', (d) => {
    const chunk = String(d);
    if (chunk.trim()) process.stderr.write(chunk);
  });
  proc.on('exit', (code) => {
    child = null;
    failAll(new Error(`agent-host exit ${code}`));
  });
  proc.on('error', (err) => {
    child = null;
    failAll(err);
  });
}

function ensureHost() {
  if (child && !child.killed) return child;
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    try {
      const       proc = spawnNode(path.join(__dirname, 'agent-host.js'), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, MAGNET_AGENT_HOST: '1', MAGNET_PORT: String(process.env.MAGNET_PORT || 3871) },
      });
      attach(proc);
      starting = null;
      resolve(proc);
    } catch (err) {
      starting = null;
      reject(err);
    }
  });
  return starting;
}

function call(op, payload = {}, opts = {}) {
  return Promise.resolve(ensureHost()).then(
    () =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = opts.timeout
          ? setTimeout(() => {
              pending.delete(id);
              try {
                write({ op: 'cancel', key: payload.key, targetId: id });
              } catch (_) {}
              reject(new Error(`${op} timed out`));
            }, opts.timeout)
          : null;
        pending.set(id, {
          resolve: (ev) => {
            if (timer) clearTimeout(timer);
            resolve(ev);
          },
          reject: (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
          },
          onEvent: opts.onEvent,
        });
        if (opts.signal) {
          if (opts.signal.aborted) {
            pending.delete(id);
            if (timer) clearTimeout(timer);
            try {
              write({ op: 'cancel', key: payload.key, targetId: id });
            } catch (_) {}
            const err = new Error('fill cancelled');
            err.cancelled = true;
            reject(err);
            return;
          }
          opts.signal.addEventListener(
            'abort',
            () => {
              const row = pending.get(id);
              pending.delete(id);
              if (timer) clearTimeout(timer);
              try {
                write({ op: 'cancel', key: payload.key, targetId: id });
              } catch (_) {}
              if (!row) return;
              const err = new Error('fill cancelled');
              err.cancelled = true;
              row.reject(err);
            },
            { once: true }
          );
        }
        write({ op, id, ...payload });
      })
  );
}

function prompt(payload, opts) {
  return call('prompt', payload, { timeout: 120000, ...opts });
}

function send(payload, opts) {
  return call('send', payload, { timeout: 300000, ...opts });
}

function create(payload, opts) {
  return call('create', payload, { timeout: 120000, ...opts });
}

function invoke(name, payload, opts) {
  return call('invoke', { name, payload, key: (payload && payload.tabId) || (opts && opts.key), model: opts && opts.model, tools: opts && opts.tools, toolSet: opts && opts.toolSet, agentId: payload && payload.agentId }, { timeout: 300000, ...opts });
}

function cancel(key) {
  if (!child) return Promise.resolve({ ok: true });
  return call('cancel', { key }, { timeout: 5000 }).catch(() => ({ ok: true }));
}

function dispose(key) {
  if (!child) return Promise.resolve({ ok: true });
  return call('dispose', { key }, { timeout: 10000 }).catch(() => ({ ok: true }));
}

function shutdown() {
  if (!child) return;
  try {
    child.kill();
  } catch (_) {}
  child = null;
  failAll(new Error('agent-host shutdown'));
}

module.exports = { ensureHost, prompt, send, create, invoke, cancel, dispose, shutdown };
