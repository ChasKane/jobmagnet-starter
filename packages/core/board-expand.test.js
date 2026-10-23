const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  expandBoards,
  huntWithNewBoards,
  loadProbeMisses,
  saveProbeMisses,
  YC_HIRING,
} = require('./src/board-expand');

function ashbyJob(slug) {
  return {
    ok: true,
    json: async () => ({
      jobs: [
        {
          title: 'Frontend Engineer',
          applyUrl: `https://jobs.ashbyhq.com/${slug}/1`,
          isRemote: true,
          location: 'Remote',
          descriptionPlain: 'React frontend',
        },
      ],
    }),
  };
}

function miss(status = 404) {
  return { ok: false, status, json: async () => ({}) };
}

test('expandBoards skips a held company and returns one frontend job from a new Ashby board', async () => {
  const urls = [];
  const out = await expandBoards({
    existingJobs: [{ company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Old' }],
    candidates: [
      { name: 'Acme Robotics', slug: 'acme' },
      { name: 'Beta', slug: 'beta' },
    ],
    criteria: { title_includes: ['frontend'] },
    sites: ['ashby', 'greenhouse', 'lever'],
    need: 1,
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).includes('job-board/beta')) return ashbyJob('beta');
      return miss();
    },
  });
  assert.equal(urls.some((url) => url.includes('acme')), false);
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0].company, 'Beta');
  assert.equal(out.jobs[0].location, 'Remote');
  assert.equal(out.addedBoards[0].ats, 'ashby');
  assert.equal(out.addedBoards[0].slug, 'beta');
});

test('expandBoards records a miss when Ashby, Greenhouse, and Lever all 404', async () => {
  const urls = [];
  const out = await expandBoards({
    candidates: [{ name: 'Nope', slug: 'nope' }],
    sites: ['ashby', 'greenhouse', 'lever'],
    need: 1,
    now: Date.parse('2026-10-09T00:00:00.000Z'),
    fetch: async (url) => {
      urls.push(String(url));
      return miss(404);
    },
  });
  assert.equal(urls.length, 3);
  assert.equal(out.jobs.length, 0);
  assert.equal(out.addedBoards.length, 0);
  assert.equal(out.misses.nope.at, '2026-10-09T00:00:00.000Z');
});

test('expandBoards does not cache a miss when a probe is not a 404', async () => {
  const out = await expandBoards({
    candidates: [{ name: 'Nope', slug: 'nope' }],
    sites: ['ashby'],
    need: 1,
    fetch: async () => miss(500),
  });
  assert.equal(out.misses.nope, undefined);
});

test('expandBoards does not re-probe a fresh miss and retries an old one', async () => {
  const now = Date.parse('2026-10-09T00:00:00.000Z');
  const fresh = await expandBoards({
    candidates: [{ name: 'Nope', slug: 'nope' }],
    misses: { nope: { at: '2026-10-08T00:00:00.000Z', slug: 'nope' } },
    sites: ['ashby'],
    need: 1,
    now,
    fetch: async () => {
      throw new Error('should not fetch a fresh miss');
    },
  });
  assert.equal(fresh.probed, 0);

  let called = 0;
  const stale = await expandBoards({
    candidates: [{ name: 'Nope', slug: 'nope' }],
    misses: { nope: { at: '2026-09-01T00:00:00.000Z', slug: 'nope' } },
    sites: ['ashby'],
    need: 1,
    now,
    fetch: async () => {
      called += 1;
      return miss(404);
    },
  });
  assert.equal(called, 1);
  assert.ok(stale.misses.nope);
});

test('expandBoards learns a live empty board and stops once it has enough jobs', async () => {
  const urls = [];
  const out = await expandBoards({
    candidates: [
      { name: 'Quiet', slug: 'quiet' },
      { name: 'Beta', slug: 'beta' },
      { name: 'Gamma', slug: 'gamma' },
    ],
    criteria: { title_includes: ['frontend'] },
    sites: ['ashby'],
    need: 1,
    batchSize: 1,
    fetch: async (url) => {
      const u = String(url);
      urls.push(u);
      if (u.includes('job-board/quiet')) return { ok: true, json: async () => ({ jobs: [] }) };
      if (u.includes('job-board/beta')) return ashbyJob('beta');
      throw new Error('should stop before gamma');
    },
  });
  assert.equal(out.addedBoards.length, 2);
  assert.equal(out.addedBoards[0].slug, 'quiet');
  assert.equal(out.jobs.length, 1);
  assert.equal(urls.some((url) => url.includes('gamma')), false);
});

test('expandBoards loads the public hiring catalog when no candidates are injected', async () => {
  const out = await expandBoards({
    sites: ['ashby'],
    need: 1,
    criteria: { title_includes: ['frontend'] },
    fetch: async (url) => {
      if (String(url) === YC_HIRING) {
        return { ok: true, json: async () => [{ name: 'Beta', slug: 'beta' }] };
      }
      assert.match(String(url), /job-board\/beta/);
      return ashbyJob('beta');
    },
  });
  assert.equal(out.jobs[0].company, 'Beta');
});

test('huntWithNewBoards adds a job when the only learned board is already listed', async () => {
  const out = await huntWithNewBoards({
    boards: [{ company: 'Acme', ats: 'greenhouse', slug: 'acme' }],
    extraJobs: [{ company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Old' }],
    schema: { n: 1, titleIncludes: ['frontend'], sites: ['ashby', 'greenhouse', 'lever'] },
    expand: true,
    candidates: [{ name: 'Beta', slug: 'beta' }],
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/acme/')) throw new Error('held board should not be fetched');
      if (u.includes('job-board/beta')) return ashbyJob('beta');
      return miss();
    },
  });
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0].company, 'Beta');
  assert.equal(out.addedBoards[0].ats, 'ashby');
});

test('huntWithNewBoards does not probe when expand is off', async () => {
  const out = await huntWithNewBoards({
    boards: [],
    extraJobs: [],
    schema: { n: 1, titleIncludes: ['frontend'], sites: ['ashby'] },
    expand: false,
    candidates: [{ name: 'Beta', slug: 'beta' }],
    fetch: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.equal(out.needBoards, true);
  assert.equal(out.jobs.length, 0);
  assert.equal(out.addedBoards.length, 0);
});

test('probe misses round-trip and drop entries older than 14 days', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-probes-'));
  const file = path.join(dir, 'board-probes.yaml');
  const now = Date.parse('2026-10-09T00:00:00.000Z');
  saveProbeMisses(
    {
      fresh: { at: '2026-10-08T00:00:00.000Z', slug: 'fresh' },
      stale: { at: '2026-09-01T00:00:00.000Z', slug: 'stale' },
    },
    file,
    now
  );
  const loaded = loadProbeMisses(file);
  assert.equal(loaded.fresh.slug, 'fresh');
  assert.equal(loaded.stale, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
