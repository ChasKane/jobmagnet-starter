const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { filterBucket, statusFrom } = require('./process-store');
const { isAgentJob } = require('./jobs-file');
const {
  recordSubmission,
  loadSubmissions,
  unionSubmissions,
  effectiveStatus,
  mergeJobEntries,
  importAgentRows,
  appendAgentNote,
} = require('./ai-submissions');

function tempLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-sub-'));
  return path.join(dir, 'ai-submissions.yaml');
}

test('ledger records a submission once and keeps the first time', () => {
  const file = tempLedger();
  const first = recordSubmission(
    { url: 'https://jobs.ashbyhq.com/acme/fe', company: 'Acme', title: 'Frontend Engineer', location: 'Remote' },
    file
  );
  const second = recordSubmission(
    { url: 'https://jobs.ashbyhq.com/acme/fe', company: 'Acme', title: 'Frontend Engineer', submitted_at: '2099-01-01T00:00:00.000Z' },
    file
  );
  assert.equal(loadSubmissions(file).length, 1);
  assert.equal(second.submitted_at, first.submitted_at);
});

test('union keeps local rows the remote branch has not published yet', () => {
  const merged = unionSubmissions(
    [{ url: 'https://example.com/new', company: 'New', title: 'Frontend Engineer' }],
    [{ url: 'https://example.com/old', company: 'Old', title: 'Full Stack Engineer' }]
  );
  assert.deepEqual(
    merged.map((row) => row.url).sort(),
    ['https://example.com/new', 'https://example.com/old']
  );
});

test('sidebar all includes AI submissions and open stays local ingested work', () => {
  const local = [
    { id: 'tab-0', company: 'Mine', title: 'UI Engineer', url: 'https://example.com/mine', name: 'Mine' },
    { id: 'tab-1', company: 'Overlap', title: 'Frontend Engineer', url: 'https://example.com/overlap', name: 'Overlap' },
    { id: 'tab-2', company: 'Done', title: 'Full Stack Engineer', url: 'https://example.com/done', name: 'Done' },
  ];
  const submissions = [
    { url: 'https://example.com/overlap', company: 'Overlap', title: 'Frontend Engineer' },
    { url: 'https://jobs.ashbyhq.com/ai/fe', company: 'AI Co', title: 'Frontend Engineer', location: 'Remote' },
  ];
  const localStatus = {
    'https://example.com/mine': 'open',
    'https://example.com/overlap': 'open',
    'https://example.com/done': 'submitted',
  };
  const rows = mergeJobEntries(local, submissions).map((entry) => {
    const status = effectiveStatus(entry.url, localStatus[entry.url] || 'open', submissions);
    return { ...entry, status, bucket: filterBucket(status) };
  });
  const open = rows.filter((row) => row.bucket === 'open').map((row) => row.company);
  const all = rows.map((row) => row.company);
  assert.deepEqual(open, ['Mine']);
  assert.deepEqual(all, ['Mine', 'Overlap', 'Done', 'AI Co']);
  assert.equal(rows.find((row) => row.company === 'AI Co').bucket, 'submitted');
  assert.equal(rows.find((row) => row.company === 'Overlap').status, 'submitted');
  assert.equal(rows.filter((row) => row.url === 'https://example.com/overlap').length, 1);
});

test('a later local status beats the AI ledger', () => {
  const submissions = [{ url: 'https://example.com/job', company: 'Acme', title: 'Frontend Engineer' }];
  assert.equal(effectiveStatus('https://example.com/job', 'interviewing', submissions), 'interviewing');
  assert.equal(effectiveStatus('https://example.com/job', 'rejected', submissions), 'rejected');
  assert.equal(effectiveStatus('https://example.com/other', 'open', submissions), 'open');
});

function tempJobs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-jobs-'));
  const file = path.join(dir, 'jobs.yaml');
  fs.writeFileSync(file, 'jobs:\n  - company: Mine\n    title: UI Engineer\n    url: https://example.com/mine\n');
  return file;
}

test('recording an agent application writes one jobs.yaml row and keeps the first time', () => {
  const file = tempJobs();
  const first = recordSubmission(
    { url: 'https://jobs.ashbyhq.com/acme/fe', company: 'Acme', title: 'Frontend Engineer', location: 'Remote' },
    file
  );
  const second = recordSubmission(
    {
      url: 'https://jobs.ashbyhq.com/acme/fe',
      company: 'Acme',
      title: 'Frontend Engineer',
      submitted_at: '2099-01-01T00:00:00.000Z',
    },
    file
  );
  assert.equal(loadSubmissions(file).length, 1);
  assert.equal(first.agent === undefined ? true : first.agent, true);
  assert.equal(second.submitted_at, first.submitted_at);
  assert.equal(isAgentJob('https://jobs.ashbyhq.com/acme/fe', file), true);
  const doc = require('js-yaml').load(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.jobs.filter((job) => job.agent).length, 1);
  assert.equal(doc.jobs[1].agent, true);
});

test('recording a submission keeps bug notes already in jobs.yaml', () => {
  const file = tempJobs();
  fs.appendFileSync(file, 'bugs:\n  - format: JM-BUG\n    id: sample\n    what: example\n');
  recordSubmission({ url: 'https://www.linkedin.com/jobs/view/1/', company: 'Acme', title: 'Frontend Engineer' }, file);
  const doc = require('js-yaml').load(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.jobs.filter((job) => job.agent).length, 1);
  assert.equal(doc.bugs[0].id, 'sample');
});

test('import marks an existing url agent instead of adding a second row', () => {
  const file = tempJobs();
  const result = importAgentRows(
    [{ url: 'https://example.com/mine', company: 'Mine', title: 'UI Engineer', submitted_at: '2026-10-07T00:00:00.000Z' }],
    { jobsFile: file }
  );
  assert.equal(result.added, 0);
  assert.equal(result.marked, 1);
  const doc = require('js-yaml').load(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.jobs.length, 1);
  assert.equal(doc.jobs[0].agent, true);
});

test('import keeps two real submits that share a company and title', () => {
  const file = tempJobs();
  importAgentRows(
    [
      { url: 'https://www.linkedin.com/jobs/view/11/', company: 'Hire Feed', title: 'Frontend Engineer', submitted_at: '2026-10-06T00:00:00.000Z' },
      { url: 'https://www.linkedin.com/jobs/view/22/', company: 'Hire Feed', title: 'Frontend Engineer', submitted_at: '2026-10-06T01:00:00.000Z' },
    ],
    { jobsFile: file }
  );
  assert.equal(loadSubmissions(file).length, 2);
});

test('a bug note lands in jobs.yaml without dropping jobs', () => {
  const file = tempJobs();
  appendAgentNote({ id: 'dropdown-scope', area: 'autofill', what: 'Menu leaked.' }, 'bug', file);
  const doc = require('js-yaml').load(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.jobs.length, 1);
  assert.equal(doc.bugs[0].format, 'JM-BUG');
  assert.equal(doc.bugs[0].id, 'dropdown-scope');
});

test('sidebar open hides agent submits and a later local status wins', () => {
  const rows = [
    { company: 'Mine', agent: false, local: 'open' },
    { company: 'Overlap', agent: true, local: 'open' },
    { company: 'Done', agent: false, local: 'submitted' },
    { company: 'AI Co', agent: true, local: 'open' },
    { company: 'Interview', agent: true, local: 'interviewing' },
  ].map((row) => {
    const status = statusFrom(row.local, row.agent);
    return { ...row, status, bucket: filterBucket(status) };
  });
  assert.deepEqual(
    rows.filter((row) => row.bucket === 'open').map((row) => row.company),
    ['Mine']
  );
  assert.equal(rows.find((row) => row.company === 'AI Co').bucket, 'submitted');
  assert.equal(rows.find((row) => row.company === 'Interview').status, 'interviewing');
});
