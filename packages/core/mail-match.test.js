const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreJob, matchCompany } = require('./src/mail-match');

test('an ATS footer does not outrank the employer named in the subject', () => {
  const msg = {
    from: '"Mobi.AI Hiring Team" <no-reply@ashbyhq.com>',
    subject: 'Mobi.AI Application Update',
    text: 'Thank you for applying. Powered by Ashby.',
  };
  const jobs = [
    { url: 'https://jobs.ashbyhq.com/ashby/role', company: 'Ashby', title: 'Design Engineer, Americas', status: 'submitted' },
    { url: 'https://jobs.ashbyhq.com/mobi/role', company: 'Mobi.AI', title: 'Senior Frontend Engineer', status: 'submitted' },
  ];
  const ashby = scoreJob(jobs[0], msg, 'mobiai');
  const mobi = scoreJob(jobs[1], msg, 'mobiai');
  assert.equal(ashby, 0);
  assert.ok(mobi > ashby);
  const matched = matchCompany(msg, jobs);
  assert.equal(matched.matches[0].company, 'Mobi.AI');
  assert.ok(matched.matches.every((job) => job.company !== 'Ashby'));
});

test('a letter that actually names Ashby still matches Ashby', () => {
  const msg = {
    from: '"Ashby" <no-reply@ashbyhq.com>',
    subject: 'Your application to Ashby',
    text: 'Thank you for applying to Ashby.',
  };
  const score = scoreJob(
    { company: 'Ashby', title: 'Design Engineer', url: 'https://jobs.ashbyhq.com/ashby/role' },
    msg,
    'ashby'
  );
  assert.ok(score >= 60);
});
