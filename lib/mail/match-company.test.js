const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchCompany, extractCompany, fold } = require('./match-company');
const { decide } = require('./scan');

const jobs = [
  { url: 'https://jobs.ashbyhq.com/acme/fe', company: 'Acme', title: 'Frontend Engineer', status: 'submitted' },
  { url: 'https://jobs.ashbyhq.com/globex/fe', company: 'Globex', title: 'Frontend Engineer', status: 'submitted' },
  { url: 'https://jobs.lever.co/initech/be', company: 'Initech Inc', title: 'Backend Engineer', status: 'open' },
];

test('extracts company from application-to phrase', () => {
  assert.equal(
    extractCompany({
      subject: 'Your application to Acme',
      text: 'Thanks for applying.',
      from: 'no-reply@greenhouse-mail.io',
    }),
    'Acme'
  );
});

test('exact company in body maps to one submitted URL', () => {
  const m = matchCompany(
    {
      from: 'Acme <no-reply@greenhouse-mail.io>',
      subject: 'Your application to Acme',
      text: 'We will not be moving forward with your application to Acme.',
    },
    jobs
  );
  assert.equal(m.unique, true);
  assert.equal(m.submitted.length, 1);
  assert.equal(m.submitted[0].url, 'https://jobs.ashbyhq.com/acme/fe');
});

test('Inc suffix still matches', () => {
  const m = matchCompany(
    {
      from: 'talent@initech.com',
      subject: 'Update from Initech',
      text: 'Thank you for your interest in Initech.',
    },
    jobs
  );
  assert.ok(m.matches.some((j) => j.company === 'Initech Inc'));
});

test('two companies mentioned prefers the extracted one', () => {
  const m = matchCompany(
    {
      from: 'no-reply@greenhouse-mail.io',
      subject: 'Your application to Globex',
      text: 'Your application to Globex. We compared you with other teams including Acme alumni.',
    },
    jobs
  );
  assert.equal(m.matches[0].company, 'Globex');
});

test('from-domain is a bonus on top of a name hit, not a verdict alone', () => {
  const body = {
    subject: 'Your application to Acme',
    text: 'Your application to Acme is under review.',
  };
  const withDom = matchCompany({ ...body, from: 'jobs@acme.com' }, jobs);
  const noDom = matchCompany({ ...body, from: 'no-reply@greenhouse-mail.io' }, jobs);
  const acme = (m) => m.matches.find((j) => j.company === 'Acme');
  assert.ok(acme(withDom).score > acme(noDom).score);
  const domainOnly = matchCompany(
    { from: 'jobs@acme.com', subject: 'Hello', text: 'Quick note.' },
    jobs
  );
  assert.equal(
    domainOnly.matches.some((j) => j.company === 'Acme'),
    false
  );
});

test('two submitted roles at same company is not unique', () => {
  const multi = [
    { url: 'https://a/1', company: 'Acme', title: 'FE', status: 'submitted' },
    { url: 'https://a/2', company: 'Acme', title: 'Staff FE', status: 'submitted' },
  ];
  const m = matchCompany(
    {
      from: 'no-reply@greenhouse-mail.io',
      subject: 'Your application to Acme',
      text: 'Your application to Acme. We will not be moving forward.',
    },
    multi
  );
  assert.equal(m.submitted.length, 2);
  const d = decide('reject', m, false, false);
  assert.equal(d.action, 'queue');
  assert.equal(d.reason, 'multi_match');
});

test('unique submitted reject auto-applies', () => {
  const m = matchCompany(
    {
      from: 'no-reply@greenhouse-mail.io',
      subject: 'Your application to Acme',
      text: 'Your application to Acme. We will not be moving forward.',
    },
    jobs
  );
  const d = decide('reject', m, false, false);
  assert.equal(d.action, 'reject');
  assert.equal(d.url, 'https://jobs.ashbyhq.com/acme/fe');
});

test('interviewing status queues even on definite reject', () => {
  const m = matchCompany(
    {
      from: 'no-reply@greenhouse-mail.io',
      subject: 'Your application to Acme',
      text: 'Your application to Acme. We will not be moving forward.',
    },
    [{ url: 'https://a/1', company: 'Acme', title: 'FE', status: 'interviewing' }]
  );
  const d = decide('reject', m, false, false);
  assert.equal(d.action, 'queue');
  assert.equal(d.reason, 'interviewing');
});

test('fold strips punctuation', () => {
  assert.equal(fold('Acme, Inc.'), 'acmeinc');
});
