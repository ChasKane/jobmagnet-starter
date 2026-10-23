/** PostgREST client. MAGNET_STORE=supabase talks HTTP, not a Postgres socket. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const pool = require('./http-pool');

function config() {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, key, ready: Boolean(base && key) };
}

function requireConfig() {
  const cfg = config();
  if (!cfg.ready) {
    throw new Error('MAGNET_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return cfg;
}

function tmpFile(suffix = 'json') {
  return path.join(os.tmpdir(), `magnet-rest-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.${suffix}`);
}

function parseRange(header) {
  const text = String(header || '');
  const m = text.match(/(\d+)-(\d+)\/(\d+|\*)/);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) };
}

function curlArgs({ method = 'GET', path: urlPath, query = '', body, prefer = '', headers = {}, range = '' }) {
  const { base, key } = requireConfig();
  const qs = query ? (String(query).startsWith('?') ? query : `?${query}`) : '';
  const url = `${base}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}${qs}`;
  const out = tmpFile();
  const hdr = tmpFile('hdr');
  const args = [
    '-sS',
    '--connect-timeout',
    '8',
    '--max-time',
    '20',
    '-D',
    hdr,
    '-o',
    out,
    '-w',
    '%{http_code}',
    '-X',
    method,
    '-H',
    `Authorization: Bearer ${key}`,
    '-H',
    `apikey: ${key}`,
  ];
  if (prefer) args.push('-H', `Prefer: ${prefer}`);
  if (range) args.push('-H', `Range: ${range}`);
  for (const [name, value] of Object.entries(headers)) {
    if (value != null && value !== '') args.push('-H', `${name}: ${value}`);
  }
  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  }
  args.push(url);
  return { method, args, out, hdr };
}

function readCurlResult({ method, stdout, stderr, code, error, out, hdr }) {
  const status = Number(String(stdout || '').trim());
  let text = '';
  let head = '';
  try {
    text = fs.readFileSync(out, 'utf8');
  } catch (_) {}
  try {
    head = fs.readFileSync(hdr, 'utf8');
  } catch (_) {}
  try {
    fs.unlinkSync(out);
  } catch (_) {}
  try {
    fs.unlinkSync(hdr);
  } catch (_) {}
  if (error || code !== 0) {
    throw new Error((stderr || (error && error.message) || `rest ${method} failed`).slice(0, 240));
  }
  if (!status || status >= 400) {
    throw new Error((text || stderr || `rest ${method} ${status || 'failed'}`).slice(0, 240));
  }
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }
  const contentRange = (head.match(/content-range:\s*(.+)/i) || [])[1] || '';
  return { status, text, json, contentRange: String(contentRange).trim() };
}

function curlRequest(opts) {
  const spec = curlArgs(opts);
  const res = spawnSync('curl', spec.args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 25000 });
  return readCurlResult({
    method: spec.method,
    stdout: res.stdout,
    stderr: res.stderr,
    code: res.status,
    error: res.error,
    out: spec.out,
    hdr: spec.hdr,
  });
}

function httpSpec(opts) {
  const { method = 'GET', path: urlPath, query = '', body, prefer = '', headers = {}, range = '' } = opts;
  const { base, key } = requireConfig();
  const qs = query ? (String(query).startsWith('?') ? query : `?${query}`) : '';
  const url = `${base}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}${qs}`;
  const hdrs = {
    Authorization: `Bearer ${key}`,
    apikey: key,
  };
  if (prefer) hdrs.Prefer = prefer;
  if (range) hdrs.Range = range;
  for (const [name, value] of Object.entries(headers)) {
    if (value != null && value !== '') hdrs[name] = value;
  }
  let payload;
  if (body !== undefined) {
    hdrs['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return { method, url, headers: hdrs, body: payload };
}

function asResult(method, raw) {
  const status = Number(raw && raw.status) || 0;
  const text = (raw && raw.text) || '';
  if (!status || status >= 400) {
    throw new Error((text || `rest ${method} ${status || 'failed'}`).slice(0, 240));
  }
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }
  return { status, text, json, contentRange: String((raw && raw.contentRange) || '').trim() };
}

function request(opts) {
  const method = opts.method || 'GET';
  try {
    return asResult(method, pool.requestSync(httpSpec(opts)));
  } catch (err) {
    if (err && err.code === 'WORKER') return curlRequest(opts);
    throw err;
  }
}

function requestAsync(opts) {
  const method = opts.method || 'GET';
  let spec;
  try {
    spec = httpSpec(opts);
  } catch (err) {
    return Promise.reject(err);
  }
  return pool
    .requestAsync(spec)
    .then((raw) => asResult(method, raw))
    .catch((err) => {
      if (err && err.code === 'WORKER') return curlRequestAsync(opts);
      throw err;
    });
}

function curlRequestAsync(opts) {
  const spec = curlArgs(opts);
  return new Promise((resolve, reject) => {
    const child = spawn('curl', spec.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      try {
        readCurlResult({ method: spec.method, stdout, stderr, code: 1, error, out: spec.out, hdr: spec.hdr });
      } catch (_) {}
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        resolve(readCurlResult({ method: spec.method, stdout, stderr, code, out: spec.out, hdr: spec.hdr }));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function tablePath(table) {
  return `/rest/v1/${encodeURIComponent(table)}`;
}

function select(table, query = '', { pages = true } = {}) {
  const pageSize = 1000;
  const rows = [];
  let start = 0;
  for (;;) {
    const result = request({
      method: 'GET',
      path: tablePath(table),
      query,
      prefer: 'count=exact',
      range: pages ? `${start}-${start + pageSize - 1}` : '',
    });
    const chunk = Array.isArray(result.json) ? result.json : [];
    rows.push(...chunk);
    if (!pages) return rows;
    const range = parseRange(result.contentRange);
    if (!range || range.total == null || rows.length >= range.total || chunk.length < pageSize) return rows;
    start += pageSize;
  }
}

async function selectAsync(table, query = '', { pages = true } = {}) {
  const pageSize = 1000;
  const rows = [];
  let start = 0;
  for (;;) {
    const result = await requestAsync({
      method: 'GET',
      path: tablePath(table),
      query,
      prefer: 'count=exact',
      range: pages ? `${start}-${start + pageSize - 1}` : '',
    });
    const chunk = Array.isArray(result.json) ? result.json : [];
    rows.push(...chunk);
    if (!pages) return rows;
    const range = parseRange(result.contentRange);
    if (!range || range.total == null || rows.length >= range.total || chunk.length < pageSize) return rows;
    start += pageSize;
  }
}

function count(table, query = '') {
  const result = request({
    method: 'GET',
    path: tablePath(table),
    query: query || 'select=id',
    prefer: 'count=exact',
    range: '0-0',
  });
  const range = parseRange(result.contentRange);
  if (range && range.total != null) return range.total;
  return Array.isArray(result.json) ? result.json.length : 0;
}

function conflictQuery(onConflict) {
  const cols = (Array.isArray(onConflict) ? onConflict : String(onConflict || '').split(','))
    .map((col) => String(col).trim())
    .filter(Boolean);
  return cols.length ? `on_conflict=${cols.join(',')}` : '';
}

function insert(table, rows, { merge = false, ignore = false, returning = false, onConflict = [] } = {}) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return [];
  const prefer = [
    merge ? 'resolution=merge-duplicates' : '',
    ignore ? 'resolution=ignore-duplicates' : '',
    returning ? 'return=representation' : 'return=minimal',
  ]
    .filter(Boolean)
    .join(',');
  const result = request({
    method: 'POST',
    path: tablePath(table),
    query: conflictQuery(onConflict),
    body: list.length === 1 ? list[0] : list,
    prefer,
  });
  return Array.isArray(result.json) ? result.json : result.json ? [result.json] : [];
}

function insertAsync(table, rows, { merge = false, ignore = false, returning = false, onConflict = [] } = {}) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return Promise.resolve([]);
  const prefer = [
    merge ? 'resolution=merge-duplicates' : '',
    ignore ? 'resolution=ignore-duplicates' : '',
    returning ? 'return=representation' : 'return=minimal',
  ]
    .filter(Boolean)
    .join(',');
  return requestAsync({
    method: 'POST',
    path: tablePath(table),
    query: conflictQuery(onConflict),
    body: list.length === 1 ? list[0] : list,
    prefer,
  }).then((result) => (Array.isArray(result.json) ? result.json : result.json ? [result.json] : []));
}

function patch(table, query, body, { returning = false } = {}) {
  if (!query) throw new Error(`rest patch ${table} needs a filter`);
  const result = request({
    method: 'PATCH',
    path: tablePath(table),
    query,
    body,
    prefer: returning ? 'return=representation' : 'return=minimal',
  });
  return Array.isArray(result.json) ? result.json : result.json ? [result.json] : [];
}

function patchAsync(table, query, body, { returning = false } = {}) {
  if (!query) throw new Error(`rest patch ${table} needs a filter`);
  return requestAsync({
    method: 'PATCH',
    path: tablePath(table),
    query,
    body,
    prefer: returning ? 'return=representation' : 'return=minimal',
  }).then((result) => (Array.isArray(result.json) ? result.json : result.json ? [result.json] : []));
}

function del(table, query, { returning = false } = {}) {
  if (!query) throw new Error(`rest delete ${table} needs a filter`);
  const result = request({
    method: 'DELETE',
    path: tablePath(table),
    query,
    prefer: returning ? 'return=representation' : 'return=minimal',
  });
  return Array.isArray(result.json) ? result.json : result.json ? [result.json] : [];
}

function delAsync(table, query, { returning = false } = {}) {
  if (!query) return Promise.reject(new Error(`rest delete ${table} needs a filter`));
  return requestAsync({
    method: 'DELETE',
    path: tablePath(table),
    query,
    prefer: returning ? 'return=representation' : 'return=minimal',
  }).then((result) => (Array.isArray(result.json) ? result.json : result.json ? [result.json] : []));
}

module.exports = {
  config,
  requireConfig,
  request,
  requestAsync,
  select,
  selectAsync,
  count,
  insert,
  insertAsync,
  patch,
  patchAsync,
  del,
  delAsync,
};
