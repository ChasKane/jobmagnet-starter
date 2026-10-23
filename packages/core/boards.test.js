const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boardFromUrl, huntJobs, matchesCriteria } = require('./src/boards');
const { createMemoryStore } = require('./src/memory-store');
const { createMagnetApp } = require('./src/magnet-app');

test('boardFromUrl reads greenhouse / ashby / lever slugs', () => {
  assert.deepEqual(boardFromUrl('https://job-boards.greenhouse.io/affinitiv/jobs/1'), {
    ats: 'greenhouse',
    slug: 'affinitiv',
    source_url: 'https://job-boards.greenhouse.io/affinitiv/jobs/1',
  });
  assert.equal(boardFromUrl('https://jobs.ashbyhq.com/Cedar/abc').slug, 'Cedar');
  assert.equal(boardFromUrl('https://jobs.lever.co/doxel/abc').ats, 'lever');
  assert.equal(boardFromUrl('magnet://sample/contoso'), null);
});

test('matchesCriteria requires a title hit when titles are set', () => {
  assert.equal(matchesCriteria({ title: 'Staff Frontend' }, { title_includes: ['frontend'] }), true);
  assert.equal(matchesCriteria({ title: 'Backend' }, { title_includes: ['frontend'] }), false);
});

test('huntJobs skips a company already listed and keeps one posting from a new board', async () => {
  const fetched = [];
  const out = await huntJobs({
    boards: [
      { company: 'Acme', ats: 'greenhouse', slug: 'acme' },
      { company: 'Beta', ats: 'greenhouse', slug: 'beta' },
    ],
    extraJobs: [{ company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Old' }],
    schema: { n: 10, titleIncludes: ['frontend'], sites: ['greenhouse'] },
    fetch: async (url) => {
      fetched.push(String(url));
      const slug = String(url).includes('/beta/') ? 'beta' : 'acme';
      return {
        ok: true,
        json: async () => ({
          jobs: [
            {
              title: 'Staff Frontend',
              absolute_url: `https://boards.greenhouse.io/${slug}/jobs/2`,
              content: 'React frontend',
            },
            {
              title: 'Frontend Engineer',
              absolute_url: `https://boards.greenhouse.io/${slug}/jobs/3`,
              content: 'React frontend',
            },
          ],
        }),
      };
    },
  });
  assert.equal(fetched.some((u) => u.includes('/acme/')), false);
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0].company, 'Beta');
});

test('huntJobs keeps one opening when the plan names a new company', async () => {
  const out = await huntJobs({
    boards: [{ company: 'Acme', ats: 'greenhouse', slug: 'acme' }],
    extraJobs: [],
    schema: { n: 10, company: 'Acme', titleIncludes: ['frontend'], sites: ['greenhouse'] },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        jobs: [
          { title: 'Staff Frontend', absolute_url: 'https://boards.greenhouse.io/acme/jobs/2', content: 'React frontend' },
          { title: 'Frontend Engineer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/3', content: 'React frontend' },
        ],
      }),
    }),
  });
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0].company, 'Acme');
});

test('huntJobs skips a named company that is already listed', async () => {
  const out = await huntJobs({
    boards: [{ company: 'Acme', ats: 'greenhouse', slug: 'acme' }],
    extraJobs: [{ company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Old' }],
    schema: { n: 10, company: 'Acme', titleIncludes: ['frontend'], sites: ['greenhouse'] },
    fetch: async () => {
      throw new Error('should not fetch a company already listed');
    },
  });
  assert.equal(out.jobs.length, 0);
  assert.equal(out.companyHeld, 1);
});

test('huntJobs refuses a plan with no count', async () => {
  const out = await huntJobs({
    boards: [{ company: 'Acme', ats: 'greenhouse', slug: 'acme' }],
    schema: { titleIncludes: ['frontend'] },
    fetch: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.equal(out.missingCount, true);
  assert.equal(out.jobs.length, 0);
});

test('huntJobs returns needBoards when none are known', async () => {
  const out = await huntJobs({ boards: [], extraJobs: [], schema: { n: 4, titleIncludes: ['react'] } });
  assert.equal(out.needBoards, true);
});

test('approveSearch hunts public board JSON without a search port', async () => {
  const store = createMemoryStore({
    boards: [{ company: 'Acme', ats: 'greenhouse', slug: 'acme' }],
  });
  const app = createMagnetApp({
    store,
    fetch: async (url) => {
      assert.match(String(url), /boards-api\.greenhouse\.io\/v1\/boards\/acme/);
      return {
        ok: true,
        json: async () => ({
          jobs: [
            {
              title: 'Staff Frontend Engineer',
              absolute_url: 'https://boards.greenhouse.io/acme/jobs/9',
              location: { name: 'Remote' },
              content: 'React',
            },
          ],
        }),
      };
    },
  });
  app.ingest({ text: 'find 4 remote frontend' });
  const out = await app.approveSearch({});
  assert.equal(out.needBoards, false);
  assert.equal(out.added.length, 1);
  assert.equal(out.jobs[0].company, 'Acme');
});

test('approveSearch does not discover a new company when learned companies are already listed', async () => {
  const store = createMemoryStore({
    boards: [{ company: 'Acme', ats: 'greenhouse', slug: 'acme' }],
    jobs: [{ id: 'job-1', url: 'https://boards.greenhouse.io/acme/jobs/1', company: 'Acme', title: 'Old' }],
  });
  const app = createMagnetApp({
    store,
    fetch: async () => {
      throw new Error('should not fetch a company already listed');
    },
  });
  const out = await app.approveSearch({
    schema: { n: 1, titleIncludes: ['frontend'], sites: ['ashby', 'greenhouse', 'lever'] },
  });
  assert.equal(out.added.length, 0);
  assert.equal(store.listJobs().length, 1);
});
