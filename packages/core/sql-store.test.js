const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `magnet-sqlstore-${process.pid}.sqlite`);
process.env.MAGNET_DB = dbFile;
try {
  fs.unlinkSync(dbFile);
} catch (_) {}

const store = require('../../lib/store');
const { createSqlStore } = require('./src/sql-store');

function reset() {
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  store.close();
  store.open(dbFile);
  return createSqlStore(store);
}

test('sql-store jobs, resumes bytes, bundle, and turn bodies', () => {
  const api = reset();
  const job = api.upsertJob({
    id: 'job-1',
    url: 'https://jobs.example.com/apply',
    company: 'Example',
    title: 'Engineer',
  });
  assert.equal(api.listJobs().length, 1);
  assert.equal(api.hasJobUrl(job.url), true);
  api.importResume({
    id: 'default',
    label: 'SE',
    filename: 'resume.pdf',
    bytes: Buffer.from('%PDF-1.4').toString('base64'),
    isDefault: true,
  });
  const resume = api.pickResume(job);
  assert.equal(resume.id, 'default');
  assert.ok(resume.bytes);
  api.importGraph({
    cards: [
      {
        id: 'card_ops',
        employer: 'Freelance',
        claim: 'Shipped an ops platform',
        claim_shape: 'ops_platform',
        proof: 'Audit log',
        confidence: 'corroborated',
      },
      {
        id: 'card_fe',
        employer: 'Peloton',
        claim: 'Converted marketing pages',
        claim_shape: 'page_builder',
        proof: 'PB',
        confidence: 'corroborated',
      },
    ],
    card_tags: [
      { card_id: 'card_ops', tag: 'ops-platform' },
      { card_id: 'card_fe', tag: 'frontend' },
    ],
    bindings: [{ id: 'b1', question_shape: 'why-us', tag: 'ops-platform', source: 'test' }],
  });
  const bodies = api.pickTurnBodies({ fields: [{ label: 'Why do you want this role?' }], inferShape: () => 'why-us' });
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].claim, /ops platform/i);
  const bundle = api.exportBundle();
  assert.ok(bundle.graph.cards.length >= 2);
  assert.ok(bundle.resumes[0].bytes);
  const api2 = reset();
  api2.importBundle(bundle);
  assert.equal(api2.listJobs().length, 1);
  assert.equal(api2.pickTurnBodies({ fields: [{ label: 'Why us' }], inferShape: () => 'why-us' }).length, 1);
  const imported = api2.listJobs()[0];
  api2.writeProcess(imported.url, { review: [{ id: 'pitch', label: 'Why us', reason: 'needs_llm' }] });
  assert.equal(api2.getProcess(imported.url).review[0].id, 'pitch');
  store.close();
});
