const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magnet-library-'));
process.env.MAGNET_DB = path.join(root, 'magnet.sqlite');
process.env.MAGNET_PROFILE = path.join(root, 'profile.yaml');
process.env.MAGNET_NOTES = path.join(root, 'notes.yaml');
process.env.MAGNET_ANSWERS_LOG = path.join(root, 'fields.jsonl');
process.env.MAGNET_ANSWERS = path.join(root, 'essays.jsonl');
process.env.MAGNET_ARCHIVE = path.join(root, 'archive');
process.env.MAGNET_KNOWLEDGE = path.join(root, 'knowledge');
process.env.MAGNET_VOICE_FILE = path.join(root, 'voice.md');
process.env.MAGNET_STORE = 'sqlite';
fs.mkdirSync(process.env.MAGNET_KNOWLEDGE, { recursive: true });
fs.mkdirSync(process.env.MAGNET_ARCHIVE, { recursive: true });
fs.writeFileSync(
  process.env.MAGNET_PROFILE,
  '# keep\nidentity:\n  phone: "1"\n  first_name: Alex\nskills:\n  as_of: 2026-09\n'
);

const library = require('./library');
const graph = require('./graph');
const facts = require('./profile-facts');

test('catalog lists story cards, the autofill profile, and logs', () => {
  const ids = library.catalog().sections.map((section) => section.id);
  assert.ok(ids.includes('cards'));
  assert.ok(ids.includes('profile'));
  assert.ok(ids.includes('answers'));
  assert.ok(ids.includes('events'));
});

test('story card edits replace proof instead of appending it', () => {
  const created = library.write({
    section: 'cards',
    action: 'create',
    record: {
      employer: 'Peloton',
      claim: 'Converted pages to Page Builder.',
      proof: 'first',
      tags: ['frontend'],
      confidence: 'corroborated',
    },
  });
  assert.equal(created.ok, true);
  const updated = library.write({
    section: 'cards',
    action: 'save',
    id: created.id,
    record: { ...created.record, proof: 'replaced' },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.record.proof, 'replaced');
  assert.deepEqual(updated.record.tags, ['frontend']);
  const clash = library.write({
    section: 'cards',
    action: 'create',
    record: { employer: 'Peloton', claim: 'Converted pages to Page Builder.', proof: 'other' },
  });
  assert.equal(clash.ok, false);
  assert.match(clash.error, /already uses this claim/);
  const removed = library.write({ section: 'cards', action: 'delete', id: created.id });
  assert.equal(removed.ok, true);
  assert.ok(library.read({ section: 'cards', id: created.id }).error);
});

test('profile save keeps comments and raw YAML round-trips', () => {
  facts.invalidate();
  const loaded = library.read({ section: 'profile' });
  const doc = loaded.record;
  doc.identity.phone = '2';
  const saved = library.write({ section: 'profile', action: 'save', record: doc });
  assert.equal(saved.ok, true);
  const raw = fs.readFileSync(process.env.MAGNET_PROFILE, 'utf8');
  assert.match(raw, /# keep/);
  assert.match(raw, /phone: ['"]2['"]/);
  assert.match(raw, /as_of/);
  const yamlSave = library.write({
    section: 'profile',
    action: 'yaml',
    record: { text: '# keep\nidentity:\n  phone: "9"\n  first_name: Alex\n' },
  });
  assert.equal(yamlSave.ok, true);
  assert.match(fs.readFileSync(process.env.MAGNET_PROFILE, 'utf8'), /# keep/);
  assert.equal(library.read({ section: 'profile' }).record.identity.phone, '9');
});

test('experience notes and answer logs are readable, and logs stay read-only', () => {
  const created = library.write({
    section: 'notes',
    action: 'create',
    record: { employer: 'Peloton', text: 'Shipped Page Builder.' },
  });
  assert.equal(created.ok, true);
  const notes = library.query({ section: 'notes', q: 'Page Builder' });
  assert.equal(notes.total, 1);
  assert.match(library.read({ section: 'notes', id: notes.rows[0].id }).record.text, /Page Builder/);

  fs.writeFileSync(
    process.env.MAGNET_ANSWERS_LOG,
    `${JSON.stringify({
      ts: '2026-01-01T00:00:00.000Z',
      company: 'Acme',
      url: 'https://example.com/job',
      label: 'Phone',
      value: '555',
      password: 'secret-token',
    })}\n`
  );
  const answers = library.query({ section: 'answers', q: 'Acme' });
  assert.equal(answers.total, 1);
  const detail = library.read({ section: 'answers', id: answers.rows[0].id });
  assert.equal(detail.record.value, '555');
  assert.equal(detail.record.password, '••••');
  assert.equal(library.write({ section: 'answers', action: 'save', record: { value: 'nope' } }).ok, false);
});

test('graph events and employer rows can be opened from the library', () => {
  graph.addEvent('library.test', { hello: 'world' });
  const events = library.query({ section: 'events', q: 'library.test' });
  assert.equal(events.total, 1);
  const event = library.read({ section: 'events', id: events.rows[0].id });
  assert.equal(event.record.payload.hello, 'world');

  const created = library.write({
    section: 'timeline',
    action: 'create',
    record: { employer: 'Meta', title: 'Engineer', start: '2020-02', end: '2020-10', current: false },
  });
  assert.equal(created.ok, true);
  const saved = library.write({
    section: 'timeline',
    action: 'save',
    id: created.id,
    record: { employer: 'Meta', title: 'Software Engineer', start: '2020-02', end: '2020-10', current: false },
  });
  assert.equal(saved.ok, true);
  assert.equal(library.read({ section: 'timeline', id: saved.id }).record.title, 'Software Engineer');
});
