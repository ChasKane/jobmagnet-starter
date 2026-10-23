const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magnet-process-'));
process.env.MAGNET_KNOWLEDGE = tmp;
process.env.MAGNET_DB = path.join(tmp, 'magnet.sqlite');

const magnetStore = require('./store');
const persist = require('../packages/persist');
const store = require('./process-store');

function writeRaw(byUrl) {
  fs.writeFileSync(path.join(tmp, 'process.yaml'), yaml.dump({ by_url: byUrl }), 'utf8');
}

function resetSqlite() {
  magnetStore.close();
  persist.open(process.env.MAGNET_DB);
  store.invalidate();
}

test('writeRecord updates sqlite without a yaml reread', () => {
  resetSqlite();
  store.writeRecord('https://jobs.example.com/a', { status: 'submitted' });
  assert.equal(store.statusOf('https://jobs.example.com/a'), 'submitted');
  assert.equal(store.isOpen('https://jobs.example.com/a'), false);
  writeRaw({ 'https://jobs.example.com/a': { status: 'passed' } });
  assert.equal(store.statusOf('https://jobs.example.com/a'), 'submitted');
});

test('loadProcess still reads yaml for migrate-in', () => {
  store.invalidate();
  writeRaw({ 'https://jobs.example.com/a': { status: 'passed' } });
  assert.equal(store.loadProcess().by_url['https://jobs.example.com/a'].status, 'passed');
});

test('migrateFromYaml copies process yaml once', () => {
  resetSqlite();
  writeRaw({
    'https://jobs.example.com/m': { status: 'submitted', submitted_at: '2026-01-01' },
  });
  persist.migrateFromYaml(tmp);
  assert.equal(store.statusOf('https://jobs.example.com/m'), 'submitted');
  writeRaw({
    'https://jobs.example.com/m': { status: 'passed' },
  });
  persist.migrateFromYaml(tmp);
  assert.equal(store.statusOf('https://jobs.example.com/m'), 'submitted');
  magnetStore.close();
});
