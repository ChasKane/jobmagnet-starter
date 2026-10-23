const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchAnswerRows, formatPrior, draftsForShape, bestPriorForShape, stripNames } = require('./prior-drafts');

const rows = [
  {
    company: 'Acme',
    label: 'Why do you want this role?',
    final: 'I want to work on forecasting tools because the research is interesting.',
    origin: 'applicant',
    ts: '2026-01-03',
    score: 80,
  },
  {
    company: 'Beta',
    label: 'Tell us about a conflict with a stakeholder',
    final: 'At Peloton I disagreed about shipping Page Builder without an experiment readout.',
    origin: 'rewrite',
    ts: '2026-01-02',
    score: 70,
  },
  {
    company: 'Acme',
    label: 'Cover letter',
    final: 'Cover text that is long enough to count as an essay for the log reader.',
    origin: 'magnet',
    ts: '2026-01-01',
    score: 10,
  },
];

test('searchAnswerRows finds similar why-us essays', () => {
  const hit = searchAnswerRows(rows, { similar_to: 'Why do you want to work here?', limit: 3 });
  assert.equal(hit[0].company, 'Acme');
  assert.match(hit[0].label, /Why/);
});

test('searchAnswerRows can filter by company and query', () => {
  const hit = searchAnswerRows(rows, { company: 'Beta', query: 'page builder', limit: 3 });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].company, 'Beta');
});

test('searchAnswerRows can hide Magnet-kept rows', () => {
  const hit = searchAnswerRows(rows, { origins: ['applicant', 'rewrite'], limit: 8 });
  assert.ok(hit.every((d) => d.origin !== 'magnet'));
  assert.ok(hit.some((d) => d.company === 'Acme'));
});

test('draftsForShape prefers applicant why-us and skips magnet', () => {
  const packed = rows.map((r) => ({
    company: r.company,
    label: r.label,
    text: r.final,
    origin: r.origin,
    score: r.score,
    ts: r.ts,
  }));
  const hit = draftsForShape(packed, { shape: 'why-us', company: 'Prophet', limit: 2 });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].company, 'Acme');
  assert.equal(hit[0].origin, 'applicant');
});

test('formatPrior injects shape priors and scratch without reuse words', () => {
  const text = formatPrior(
    {
      company: 'Prophet Security',
      instruction: 'how might I end this draft?',
      fields: [{ label: 'Why this role' }],
      url: 'https://prophet.example/apply',
    },
    {
      rows,
      chats: [
        {
          url: 'https://other.example',
          company: 'OtherCo',
          messages: [{ role: 'you', text: 'At Peloton I converted marketing pages to Page Builder.' }],
        },
      ],
    }
  );
  assert.match(text, /forecasting tools/);
  assert.match(text, /Applicant\/rewrite answers of this shape \(why-us\)/);
  assert.doesNotMatch(text, /Cover text that is long enough/);
  assert.match(text, /Notes from other job chats/);
  assert.match(text, /Page Builder/);
});

test('bestPriorForShape strips company names in the rubric', () => {
  const prior = bestPriorForShape(
    { company: 'Prophet', fields: [{ label: 'Why do you want this role?' }] },
    { rows }
  );
  assert.equal(prior.origin, 'applicant');
  assert.match(prior.rubric, /forecasting/);
  assert.doesNotMatch(prior.rubric, /Acme/);
});

test('stripNames replaces employer tokens', () => {
  assert.equal(stripNames('I shipped Lupe at Acme.', ['Acme', 'Lupe']), 'I shipped that company at that company.');
});
