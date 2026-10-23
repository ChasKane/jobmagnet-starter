const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listEssays, uniqueLatest, optionsFromArgv, printEssays } = require('./essay-browser');

const SAMPLE = [
  {
    ts: '2026-09-12T20:55:58.261Z',
    company: 'Metabase',
    url: 'https://jobs.lever.co/metabase/one',
    label: 'Anything more?',
    final: 'The inspect-the-query thing is why I am here and I want to work on the asking layer.',
    origin: 'rewrite',
    score: 92,
  },
  {
    ts: '2026-09-12T20:50:00.000Z',
    company: 'Metabase',
    url: 'https://jobs.lever.co/metabase/one',
    label: 'Anything more?',
    final: 'Short magnet draft about inspect-the-query that I later rewrote into a longer answer.',
    origin: 'magnet',
    score: 8,
  },
  {
    ts: '2026-10-14T21:29:43.621Z',
    company: 'Seed',
    url: 'https://job-boards.greenhouse.io/seed/jobs/1',
    label: 'What excites you the most about this role at Seed',
    final: 'The part I want is the digital experience itself: seed.com and the product surfaces.',
    origin: 'applicant',
    score: 80,
  },
  {
    ts: '2026-10-14T21:14:29.394Z',
    company: 'Relae',
    url: 'https://job-boards.greenhouse.io/relae/jobs/1',
    label: 'Cover Letter',
    final: 'Full Stack Software Engineer at Relae builds the product that sits under energy strategy.',
    origin: 'magnet',
    score: 8,
  },
  {
    ts: '2026-09-13T17:12:58.767Z',
    company: 'Hive',
    url: 'https://jobs.lever.co/hive/one',
    label: 'Will you require sponsorship?',
    final: 'No.',
    origin: 'magnet',
  },
];

test('unique latest keeps the rewritten Metabase answer', () => {
  const out = listEssays({ unique: true, min: 40, limit: 20 }, SAMPLE);
  const meta = out.essays.filter((row) => row.company === 'Metabase');
  assert.equal(meta.length, 1);
  assert.match(meta[0].text, /asking layer/);
  assert.equal(out.total, 3);
});

test('filter by company and query', () => {
  const out = listEssays({ company: 'seed', q: 'digital', min: 40 }, SAMPLE);
  assert.equal(out.essays.length, 1);
  assert.equal(out.essays[0].company, 'Seed');
});

test('sort by company then newest', () => {
  const out = listEssays({ sort: 'company', min: 40, unique: true }, SAMPLE);
  assert.deepEqual(
    out.essays.map((row) => row.company),
    ['Metabase', 'Relae', 'Seed']
  );
});

test('short answers stay hidden until min is 0', () => {
  const hidden = listEssays({ company: 'Hive', min: 40 }, SAMPLE);
  assert.equal(hidden.essays.length, 0);
  const shown = listEssays({ company: 'Hive', min: 0, unique: false }, SAMPLE);
  assert.equal(shown.essays.length, 1);
});

test('--answers reads the application log, not user drafts', () => {
  const opts = optionsFromArgv(['--answers', '--company', 'Hive']);
  assert.equal(opts.all, true);
  const log = [
    { ts: '2026-10-15T15:00:00.000Z', company: 'Hive', url: 'https://jobs.lever.co/hive/one', label: 'City', value: 'Seattle' },
    { ts: '2026-10-15T15:00:01.000Z', company: 'Hive', url: 'https://jobs.lever.co/hive/one', label: 'Cover Letter', value: 'Long enough application-log essay for Hive.' },
  ];
  const out = listEssays(opts, log);
  assert.equal(out.essays.some((row) => row.label === 'City' && row.text === 'Seattle'), true);
  assert.equal(out.essays.some((row) => row.label === 'Anything more?'), false);
});

test('--all keeps both Metabase drafts', () => {
  const opts = optionsFromArgv(['--company', 'Metabase', '--all', '--min', '40']);
  const out = listEssays(opts, SAMPLE);
  assert.equal(opts.unique, false);
  assert.equal(out.essays.length, 2);
});

test('printEssays writes numbered questions and answers', () => {
  const text = printEssays({ company: 'Seed', min: 40, limit: 5 }, SAMPLE);
  assert.match(text, /1\. Seed · 2026-10-14/);
  assert.match(text, /Q: What excites you the most about this role at Seed/);
  assert.match(text, /digital experience/);
});

test('uniqueLatest prefers a later rewrite over an earlier magnet draft', () => {
  const rows = uniqueLatest(
    SAMPLE.filter((row) => row.company === 'Metabase').map((row) => ({
      ...row,
      text: row.final,
      label: row.label,
      url: row.url,
    }))
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].final || rows[0].text, /asking layer/);
});
