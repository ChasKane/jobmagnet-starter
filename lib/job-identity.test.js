const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalUrl, duplicateOf, indexJobs } = require('./job-identity');

test('greenhouse hosts and gh_jid are one posting', () => {
  const id = '7600498003';
  assert.equal(canonicalUrl(`https://boards.greenhouse.io/affinitiv/jobs/${id}`), `gh:${id}`);
  assert.equal(canonicalUrl(`https://job-boards.greenhouse.io/affinitiv/jobs/${id}`), `gh:${id}`);
  assert.equal(canonicalUrl(`https://careers.nebius.com/?gh_jid=${id}&utm_source=linkedin`), `gh:${id}`);
});

test('ashby, lever, and linkedin ids survive a host change', () => {
  assert.equal(
    canonicalUrl('https://jobs.ashbyhq.com/Cedar/22a41449-5095-4936-8061-bf5821b6059e/'),
    'ashby:cedar:22a41449-5095-4936-8061-bf5821b6059e'
  );
  assert.equal(
    canonicalUrl('https://jobs.lever.co/doxel/b89f2e18-4692-48ee-9ab1-7d319c06f90c'),
    'lever:doxel:b89f2e18-4692-48ee-9ab1-7d319c06f90c'
  );
  assert.equal(canonicalUrl('https://www.linkedin.com/jobs/view/4464111368/'), 'li:4464111368');
});

test('same company and title on another board is a duplicate', () => {
  const index = indexJobs([
    { company: 'Reddit, Inc.', title: 'Frontend Engineer', url: 'https://job-boards.greenhouse.io/reddit/jobs/1' },
  ]);
  const hit = duplicateOf(
    { company: 'reddit', title: 'Frontend Engineer', url: 'https://jobs.ashbyhq.com/reddit/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    index
  );
  assert.equal(hit.reason, 'same company and title');
});

test('a different title at the same company is not a duplicate', () => {
  const index = indexJobs([
    { company: 'Reddit', title: 'Frontend Engineer', url: 'https://job-boards.greenhouse.io/reddit/jobs/1' },
  ]);
  assert.equal(
    duplicateOf(
      { company: 'Reddit', title: 'Backend Engineer', url: 'https://job-boards.greenhouse.io/reddit/jobs/2' },
      index
    ),
    null
  );
});
