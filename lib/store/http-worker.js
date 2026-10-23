/** Keep-alive HTTP for the Supabase client. One process, reused sockets. */

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

const HEADER = 32;
const meta = new Int32Array(workerData.sab, 0, 8);
const bytes = Buffer.from(workerData.sab, HEADER);

const agents = {
  'https:': new https.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 60000 }),
  'http:': new http.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 60000 }),
};

function callOnce(spec) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(spec.url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(
      spec.url,
      {
        method: spec.method || 'GET',
        headers: spec.headers || {},
        agent: agents[url.protocol] || agents['https:'],
        timeout: 20000,
        maxHeaderSize: 256 * 1024,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf8'),
            contentRange: String(res.headers['content-range'] || ''),
          });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rest timeout')));
    req.on('error', reject);
    if (spec.body != null) req.end(spec.body);
    else req.end();
  });
}

function call(spec) {
  return callOnce(spec).catch((err) => {
    const msg = String((err && err.message) || err);
    if (!/socket hang up|ECONNRESET|EPIPE/i.test(msg)) throw err;
    return callOnce(spec);
  });
}

function writeSync(result) {
  const range = Buffer.from(String(result.contentRange || ''), 'utf8');
  let body = Buffer.from(String(result.text || ''), 'utf8');
  let flags = result.error ? 1 : 0;
  if (range.length + body.length > bytes.length) {
    const file = path.join(os.tmpdir(), `magnet-rest-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(file, result.text || '');
    body = Buffer.from(file, 'utf8');
    flags |= 2;
  }
  range.copy(bytes, 0);
  body.copy(bytes, range.length);
  Atomics.store(meta, 1, result.status || 0);
  Atomics.store(meta, 2, body.length);
  Atomics.store(meta, 3, flags);
  Atomics.store(meta, 5, range.length);
  Atomics.store(meta, 0, 2);
  Atomics.notify(meta, 0);
}

parentPort.on('message', (msg) => {
  call(msg)
    .then((result) => {
      if (msg.kind === 'sync') writeSync(result);
      else parentPort.postMessage({ id: msg.id, ok: true, ...result });
    })
    .catch((err) => {
      const error = String((err && err.message) || err || 'rest failed');
      if (msg.kind === 'sync') writeSync({ status: 0, text: error, contentRange: '', error: true });
      else parentPort.postMessage({ id: msg.id, ok: false, error });
    });
});
