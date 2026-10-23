const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function ready() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function request(method, bucket, objectPath, filePath) {
  if (!ready()) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for storage');
  const base = String(process.env.SUPABASE_URL).replace(/\/$/, '');
  const url = `${base}/storage/v1/object/${bucket}/${objectPath}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const args = ['-fsS', '--connect-timeout', '8', '--max-time', '20', '-X', method, '-H', `Authorization: Bearer ${key}`, '-H', `apikey: ${key}`];
  if (method === 'POST' || method === 'PUT') {
    args.push('-H', 'Content-Type: application/octet-stream', '-H', 'x-upsert: true', '--data-binary', `@${filePath}`);
  }
  if (method === 'GET') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    args.push('-o', filePath);
  }
  args.push(url);
  const res = spawnSync('curl', args, { encoding: 'utf8', timeout: 25000 });
  if (res.error || res.status !== 0) {
    throw new Error(String((res.stderr || (res.error && res.error.message) || 'storage request failed')).slice(0, 240));
  }
}

function upload(bucket, objectPath, filePath) {
  request('POST', bucket, objectPath, filePath);
  return `${bucket}/${objectPath}`;
}

function download(bucket, objectPath, filePath) {
  request('GET', bucket, objectPath, filePath);
  return filePath;
}

function cachePath(bucket, objectPath) {
  return path.join(os.tmpdir(), 'jobmagnet-storage', bucket, objectPath);
}

module.exports = { ready, upload, download, cachePath };
