const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magnet-chat-'));
fs.mkdirSync(path.join(tmp, 'archive'), { recursive: true });
process.env.MAGNET_KNOWLEDGE = tmp;
process.env.MAGNET_DB = path.join(tmp, 'magnet.sqlite');

const magnetStore = require('./store');
const persist = require('../packages/persist');
const chat = require('./tab-chat');

function writeRaw(byUrl) {
  fs.writeFileSync(path.join(tmp, 'archive', 'chats.json'), JSON.stringify({ by_url: byUrl }), 'utf8');
}

function resetSqlite() {
  magnetStore.close();
  persist.open(process.env.MAGNET_DB);
  chat.invalidate();
}

test('saveChat updates sqlite', () => {
  resetSqlite();
  chat.saveChat('https://jobs.example.com/a', [{ role: 'you', text: 'saved', at: 3 }]);
  assert.equal(chat.loadChat('https://jobs.example.com/a')[0].text, 'saved');
});

test('saveChat keeps error folds', () => {
  resetSqlite();
  chat.saveChat('__ingest__', [
    {
      role: 'magnet',
      text: 'Search failed.',
      folds: [{ level: 'error', label: 'error', text: 'invoke timed out' }],
      at: 9,
    },
  ]);
  const row = chat.loadChat('__ingest__')[0];
  assert.equal(row.text, 'Search failed.');
  assert.deepEqual(row.folds, [{ level: 'error', label: 'error', text: 'invoke timed out' }]);
});

test('yaml edits are not the live chat source', () => {
  resetSqlite();
  chat.saveChat('https://jobs.example.com/a', [{ role: 'you', text: 'hi', at: 1 }]);
  writeRaw({
    'https://jobs.example.com/a': {
      messages: [{ role: 'you', text: 'bye', at: 2 }],
    },
  });
  assert.equal(chat.loadChat('https://jobs.example.com/a')[0].text, 'hi');
});

test('migrateFromYaml copies chats.json once', () => {
  resetSqlite();
  writeRaw({
    'https://jobs.example.com/b': {
      messages: [{ role: 'you', text: 'migrated', at: 4 }],
      folded: [],
      company: 'Acme',
    },
  });
  persist.migrateFromYaml(tmp);
  assert.equal(chat.loadChat('https://jobs.example.com/b')[0].text, 'migrated');
  writeRaw({
    'https://jobs.example.com/b': {
      messages: [{ role: 'you', text: 'stale', at: 5 }],
    },
  });
  persist.migrateFromYaml(tmp);
  assert.equal(chat.loadChat('https://jobs.example.com/b')[0].text, 'migrated');
  magnetStore.close();
});
