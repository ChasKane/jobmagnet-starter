const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magnet-discover-cue-'));
process.env.MAGNET_KNOWLEDGE = tmp;
process.env.MAGNET_DB = path.join(tmp, 'magnet.sqlite');

const persist = require('../packages/persist');
const magnetStore = require('./store');
const { getRecord, writeRecord, invalidate } = require('./process-store');
const { persistJd } = require('./discover');

function reset() {
  magnetStore.close();
  persist.open(process.env.MAGNET_DB);
  invalidate();
}

const JD_TEXT = `About the role
We are looking for a frontend engineer.
Responsibilities
Build the product.
Requirements
Five years of TypeScript and React.
What you will do
Ship UI.`;

test('persistJd keeps apply_surface and apply_cta', async () => {
  reset();
  const url = 'https://jobs.example.com/role';
  const ok = await persistJd({
    url,
    title: 'Eng',
    posting: url,
    jd: {
      text: JD_TEXT,
      source: 'ingest',
      captured_at: new Date().toISOString(),
      findings: { ok: true, findings: [] },
      apply_surface: 'needs_click',
      apply_cta: { text: 'Apply now', href: '/apply' },
    },
  });
  assert.equal(ok, true);
  const rec = getRecord(url);
  assert.equal(rec.jd.apply_surface, 'needs_click');
  assert.equal(rec.jd.apply_cta.text, 'Apply now');
  assert.equal(rec.jd.apply_cta.href, '/apply');
});

test('persistJd can merge a cue onto an existing posting', async () => {
  reset();
  const url = 'https://jobs.example.com/kept';
  writeRecord(url, {
    jd: {
      text: JD_TEXT,
      source: 'ingest',
      captured_at: new Date().toISOString(),
      findings: { ok: true, findings: [] },
    },
  });
  const again = await persistJd({
    url,
    jd: {
      text: JD_TEXT,
      source: 'ingest',
      captured_at: new Date().toISOString(),
      findings: { ok: true, findings: [] },
      apply_surface: 'form',
    },
  });
  assert.equal(again, true);
  assert.equal(getRecord(url).jd.apply_surface, 'form');
});
