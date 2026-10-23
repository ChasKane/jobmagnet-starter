const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KEEP_DAYS = 14;

function archiveRoot() {
  return process.env.MAGNET_ARCHIVE || path.join(__dirname, '..', 'knowledge', 'archive');
}

function actionsDir() {
  return path.join(archiveRoot(), 'actions');
}

function blobsDir() {
  return path.join(archiveRoot(), 'blobs');
}

function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function putBlob(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return null;
  const sha = crypto.createHash('sha256').update(text).digest('hex');
  fs.mkdirSync(blobsDir(), { recursive: true });
  const dest = path.join(blobsDir(), sha);
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, text);
  return sha;
}

function readBlob(sha) {
  if (!sha) return '';
  try {
    return fs.readFileSync(path.join(blobsDir(), sha), 'utf8');
  } catch (_) {
    return '';
  }
}

function rotate() {
  const ACTIONS = actionsDir();
  fs.mkdirSync(ACTIONS, { recursive: true });
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  let names = [];
  try {
    names = fs.readdirSync(ACTIONS);
  } catch (_) {
    return;
  }
  for (const name of names) {
    const full = path.join(ACTIONS, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (st.mtimeMs < cutoff) {
      try {
        fs.unlinkSync(full);
      } catch (_) {}
      continue;
    }
    if (name.endsWith('.jsonl') && name.slice(0, 10) < dayStamp() && !fs.existsSync(`${full}.gz`)) {
      try {
        fs.writeFileSync(`${full}.gz`, zlib.gzipSync(fs.readFileSync(full)));
        fs.unlinkSync(full);
      } catch (_) {}
    }
  }
}

function append(entry) {
  rotate();
  const ACTIONS = actionsDir();
  fs.mkdirSync(ACTIONS, { recursive: true });
  const file = path.join(ACTIONS, `${dayStamp()}.jsonl`);
  const blob_refs = [];
  const blobs = entry.blobs || {};
  for (const [key, val] of Object.entries(blobs)) {
    const sha = putBlob(val);
    if (sha) blob_refs.push({ key, sha });
  }
  const row = {
    ts: new Date().toISOString(),
    request_id: entry.request_id,
    kind: entry.kind,
    summary: entry.summary || '',
    blob_refs,
  };
  if (entry.extra && typeof entry.extra === 'object') Object.assign(row, entry.extra);
  try {
    const remote = require('./store/remote-log').insert('action_log', {
      ts: row.ts,
      request_id: row.request_id || null,
      kind: row.kind,
      summary: row.summary || '',
      extra: row,
    });
    if (remote) return row;
  } catch (err) {
    console.warn('[magnet] action log:', (err && err.message) || err);
  }
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}

function newRequestId() {
  return crypto.randomUUID();
}

function listActionFiles() {
  const ACTIONS = actionsDir();
  fs.mkdirSync(ACTIONS, { recursive: true });
  return fs
    .readdirSync(ACTIONS)
    .filter((n) => n.endsWith('.jsonl') || n.endsWith('.jsonl.gz'))
    .sort()
    .map((n) => path.join(ACTIONS, n));
}

function readLines(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (_) {
    return [];
  }
  const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function listEntries() {
  const rows = [];
  for (const file of listActionFiles()) rows.push(...readLines(file));
  return rows;
}

function loadRequest(requestId) {
  const rows = [];
  for (const file of listActionFiles()) {
    for (const row of readLines(file)) {
      if (row.request_id === requestId) rows.push(row);
    }
  }
  return rows;
}

function hydrate(row) {
  const blobs = {};
  for (const ref of row.blob_refs || []) {
    const raw = readBlob(ref.sha);
    try {
      blobs[ref.key] = JSON.parse(raw);
    } catch {
      blobs[ref.key] = raw;
    }
  }
  return { ...row, blobs };
}

module.exports = {
  append,
  putBlob,
  readBlob,
  newRequestId,
  loadRequest,
  listEntries,
  hydrate,
  rotate,
  actionsDir,
  blobsDir,
};
