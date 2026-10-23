const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-audit-'));
process.env.MAGNET_ANSWERS = path.join(dir, 'answers.jsonl');
process.env.MAGNET_ANSWERS_LOG = path.join(dir, 'fields.jsonl');
process.env.MAGNET_DB = path.join(dir, 'magnet.sqlite');
process.env.MAGNET_KNOWLEDGE = dir;
process.env.MAGNET_STORE = 'sqlite';

const { recordEssay, loadLoggedEssays } = require('./essay-log');
const { recordAnswers, loadLoggedAnswers } = require('./answer-log');
const { loadAnswerRows, searchAnswerRows } = require('./prior-drafts');
const { rankAnswer } = require('./answer-rank');
const { isEligibleFinal } = require('./voice-rules');
const { eligiblePairs } = require('./voice-debrief');
const { applyConfirm, applyContradict } = require('./confirmations');
const { rememberFootprint, lookupFootprint } = require('./footprint');

const URL = 'https://jobs.example.com/learn';

test('user-typed drafts enter the learning store and harvest does not', () => {
  recordEssay({
    url: URL,
    company: 'Acme',
    label: 'Why Acme',
    final: 'I want to work on the asking layer, not a résumé tour of three employers.',
    origin: 'applicant',
    id: 'user-1',
  });
  recordAnswers(
    [
      { id: 'fn', label: 'First name', current: 'Alex', route: 'static' },
      {
        id: 'why',
        label: 'Why Acme',
        current: 'Magnet or the daily-apply agent typed this shipped answer into the form.',
        route: 'needs_llm',
        origin: 'autofill',
      },
    ],
    { url: URL, company: 'Acme' }
  );
  assert.equal(recordEssay({ url: URL, label: 'Why', final: 'x'.repeat(50), origin: 'autofill' }), null);

  const drafts = loadLoggedEssays();
  assert.equal(drafts.length, 1);
  assert.match(drafts[0].final, /asking layer/);

  const shipped = loadLoggedAnswers();
  assert.equal(shipped.length, 2);
  assert.ok(shipped.some((row) => row.label === 'First name'));

  const learned = loadAnswerRows().filter((row) => row.url === URL);
  assert.equal(learned.length, 1);
  assert.equal(learned[0].origin, 'applicant');
  assert.ok(!learned.some((row) => /daily-apply agent/.test(row.final || '')));
});

test('priors and voice learn only from applicant rewrite or edit', () => {
  const rows = [
    { origin: 'applicant', final: 'I wrote this cover from scratch about the asking layer itself.', label: 'Cover', score: 100 },
    { origin: 'rewrite', final: 'Cut the tour. Ownership bounds matter when I did not own experiment readouts.', label: 'Why us', score: 80 },
    { origin: 'magnet', final: 'Magnet shipped this unchanged paragraph about being excited to apply.', label: 'Why us', score: 8 },
    { origin: 'autofill', final: 'Harvested ATS text that should never teach voice.', label: 'Why us', score: 100 },
  ];
  const priors = searchAnswerRows(rows, { origins: ['applicant', 'rewrite'], limit: 8 });
  assert.ok(priors.every((row) => row.origin === 'applicant' || row.origin === 'rewrite'));
  assert.equal(eligiblePairs(rows).every((row) => isEligibleFinal(row)), true);
  assert.equal(isEligibleFinal(rows[2]), false);
  assert.equal(isEligibleFinal(rows[3]), false);
  assert.equal(rankAnswer({ llm_draft: 'draft', final: 'draft' }).origin, 'magnet');
  assert.equal(rankAnswer({ final: 'only the applicant typed this' }).origin, 'applicant');
});

test('confirmations and taught footprints still write user input', () => {
  const confirmed = applyConfirm({}, 'sponsorship', 'No', { source: 'accept' });
  assert.equal(confirmed.writes[0].value, false);
  const contradicted = applyContradict(confirmed.doc, 'sponsorship');
  assert.equal(contradicted.row.confidence, 'contradicted');

  const file = path.join(dir, 'footprints.yaml');
  const opts = [{ text: 'Yes' }, { text: 'No' }];
  rememberFootprint('Do you require sponsorship?', opts, 'No', 'profile', file);
  rememberFootprint('Do you require sponsorship?', opts, 'Yes', 'taught', file);
  const hit = lookupFootprint('Do you require sponsorship?', opts, file);
  assert.equal(hit.answer, 'Yes');
  assert.equal(hit.source, 'taught');
});
