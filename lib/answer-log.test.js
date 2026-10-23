const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-log-'));
process.env.MAGNET_ANSWERS = path.join(dir, 'answers.jsonl');
process.env.MAGNET_ANSWERS_LOG = path.join(dir, 'fields.jsonl');
process.env.MAGNET_DB = path.join(dir, 'magnet.sqlite');
process.env.MAGNET_KNOWLEDGE = dir;
process.env.MAGNET_STORE = 'sqlite';

const { collectAnswers, recordAnswers, loadLoggedAnswers, describeAnswer } = require('./answer-log');
const { loadLoggedEssays } = require('./essay-log');

const META = { url: 'https://job-boards.greenhouse.io/acme/jobs/1', company: 'Acme', name: 'Acme' };

test('collectAnswers keeps the listing url and merges longer values', () => {
  const rows = collectAnswers(
    [
      [
        { id: 'a', label: 'First name', current: 'Alex', route: 'static' },
        { id: 'b', label: 'Why Acme', current: 'I want to build the editor people ship.', route: 'needs_llm' },
      ],
      [{ id: 'b', label: 'Why Acme', final: 'I want to build the editor people ship, and stay on the asking layer.', route: 'needs_llm' }],
    ],
    META
  );
  assert.equal(rows.length, 2);
  const essay = rows.find((row) => row.kind === 'essay');
  const name = rows.find((row) => row.kind === 'static');
  assert.equal(name.company, 'Acme');
  assert.equal(name.url, META.url);
  assert.equal(name.value, 'Alex');
  assert.match(essay.value, /asking layer/);
});

test('chrome, empty, and file fields are skipped', () => {
  assert.equal(describeAnswer({ id: 'x', label: 'Resume', type: 'file', current: 'cv.pdf' }, META), null);
  assert.equal(describeAnswer({ id: 'y', label: '', current: 'nope' }, META), null);
  assert.equal(describeAnswer({ id: 'z', label: 'Name', current: '  ' }, META), null);
  assert.equal(
    describeAnswer({ id: 'c', label: 'Close', route: 'skip', reason: 'chrome', current: 'x' }, META),
    null
  );
});

test('recordAnswers writes the application log and leaves user drafts alone', () => {
  const rows = recordAnswers(
    [
      { id: 'fn', label: 'First name', intended: 'Alex', route: 'static' },
      {
        id: 'why',
        label: 'Why this role',
        llm_draft: 'The product surface is the job.',
        final: 'The product surface is the job.',
        route: 'needs_llm',
      },
    ],
    META
  );
  assert.equal(rows.length, 2);
  const logged = loadLoggedAnswers();
  assert.equal(logged.length, 2);
  assert.equal(logged.every((row) => row.url === META.url), true);
  assert.equal(loadLoggedEssays().length, 0);
  assert.equal(fs.existsSync(process.env.MAGNET_ANSWERS) ? fs.readFileSync(process.env.MAGNET_ANSWERS, 'utf8') : '', '');
});
