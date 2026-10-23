const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loginWall, loginPrompt } = require('./src/login-wall');
const { huntStartUrls, queryFromSchema } = require('./src/hunt-start');
const { parseHuntAction, runJsonHunt } = require('./src/llm-hunt');
const { compileSearchSchema } = require('./src/search-schema');

test('loginWall catches LinkedIn authwall and login paths', () => {
  assert.equal(loginWall({ url: 'https://www.linkedin.com/authwall' }).login, true);
  assert.equal(loginWall({ url: 'https://www.linkedin.com/login' }).site, 'linkedin');
  assert.equal(
    loginWall({
      url: 'https://www.linkedin.com/jobs/search/',
      text: 'Sign in to view more jobs',
    }).login,
    true
  );
  assert.equal(
    loginWall({
      url: 'https://www.linkedin.com/jobs/search/?keywords=frontend',
      title: 'Jobs',
      text: 'Senior Frontend Engineer Apply Easy Apply',
    }).login,
    false
  );
});

test('loginPrompt names LinkedIn', () => {
  const text = loginPrompt({ site: 'linkedin' });
  assert.match(text, /LinkedIn/);
  assert.match(text, /login page/i);
  assert.doesNotMatch(text, /apply pane/i);
});

test('huntStartUrls default includes linkedin', () => {
  const schema = compileSearchSchema('find remote frontend');
  const starts = huntStartUrls(schema);
  assert.ok(starts.some((s) => s.site === 'linkedin' && /linkedin\.com\/jobs\/search/.test(s.url)));
  assert.match(queryFromSchema(schema), /frontend/i);
  for (const id of [
    'weworkremotely',
    'remoteok',
    'himalayas',
    'remotive',
    'jobicy',
    'workingnomads',
    'justremote',
    'dynamitejobs',
    'nodesk',
    '4dayweek',
    'remoters',
    'realworkfromanywhere',
    'remotecurrent',
  ]) {
    assert.ok(schema.sites.includes(id), id);
  }
});

test('remote-first boards open a public start page', () => {
  const front = huntStartUrls({ n: 8, sites: ['weworkremotely', 'remoteok', 'himalayas', 'remotive', 'jobicy'], titleIncludes: ['frontend'] });
  const urls = front.map((s) => s.url).join(' ');
  assert.match(urls, /weworkremotely\.com\/categories\/remote-front-end-programming-jobs/);
  assert.match(urls, /remoteok\.com\/remote-front-end-jobs/);
  assert.match(urls, /himalayas\.app\/jobs\/front-end-developer/);
  assert.match(urls, /remotive\.com\/remote-jobs\/software-development/);
  assert.match(urls, /jobicy\.com\/remote-jobs\/software-development/);
  const added = huntStartUrls({
    n: 4,
    sites: ['workingnomads', 'justremote', 'dynamitejobs', '4dayweek', 'realworkfromanywhere', 'remotecurrent'],
    titleIncludes: ['frontend'],
  });
  const addedUrls = added.map((s) => s.url).join(' ');
  assert.match(addedUrls, /workingnomads\.com\/remote-front-end-jobs/);
  assert.match(addedUrls, /justremote\.co\/remote-frontend-developer-jobs/);
  assert.match(addedUrls, /dynamitejobs\.com\/remote-frontend-developer-jobs/);
  assert.match(addedUrls, /4dayweek\.io\/remote-engineering-jobs/);
  assert.match(addedUrls, /realworkfromanywhere\.com\/remote-frontend-jobs/);
  assert.match(addedUrls, /remotecurrent\.rook\.works/);
  const full = huntStartUrls({ n: 4, sites: ['remoteok', 'himalayas'], titleIncludes: ['full stack'] });
  assert.match(full.map((s) => s.url).join(' '), /remoteok\.com\/remote-full-stack-jobs/);
  assert.match(full.map((s) => s.url).join(' '), /himalayas\.app\/jobs\/full-stack-developer/);
});

test('learned greenhouse boards skip LinkedIn keyword proxies', () => {
  const { describeHuntPlan } = require('./src/hunt-start');
  const schema = { n: 12, sites: ['greenhouse', 'linkedin'], titleIncludes: ['frontend'] };
  const boards = [{ ats: 'greenhouse', slug: 'acme', company: 'Acme' }];
  const starts = huntStartUrls(schema, { boards });
  assert.ok(starts.every((s) => s.site !== 'greenhouse'));
  assert.ok(starts.some((s) => s.site === 'linkedin'));
  assert.doesNotMatch(starts.map((s) => s.url).join(' '), /greenhouse/i);
  const plan = describeHuntPlan(schema, boards);
  assert.match(plan, /New listings come from the browser: linkedin /);
  assert.match(plan, /Known greenhouse \(1\) company pages are rechecked/);
  assert.doesNotMatch(plan, /probes new public/);
});

test('parseHuntAction reads JSON object from model text', () => {
  const act = parseHuntAction('Sure.\n{"action":"click","ref":"e4"}\n');
  assert.equal(act.action, 'click');
  assert.equal(act.ref, 'e4');
});

const FULL_HUNT_JD = `Staff Frontend Engineer
About the role
You will own the apply surface and ship weekly with the authors who use it.
What we're looking for
Responsibilities include pairing on React forms, reviewing leftovers, and keeping the ATS paint honest.
Requirements
5+ years building product UI in TypeScript.
${'The posting continues with benefits, salary, and education so ingest stores the homepage text. '.repeat(8)}`;

test('runJsonHunt adds listings until n', async () => {
  let url = 'https://www.linkedin.com/jobs/search/';
  const llm = {
    async prompt({ text }) {
      if (/jobs\/view\/1/.test(text)) {
        return {
          reply: JSON.stringify({
            action: 'add',
            url: 'https://www.linkedin.com/jobs/view/1',
            title: 'Frontend',
            company: 'Acme',
          }),
        };
      }
      return { reply: JSON.stringify({ action: 'open', url: 'https://www.linkedin.com/jobs/view/1' }) };
    },
  };
  const browser = {
    async open(next) {
      url = next;
      return { url, title: 'page', text: url.includes('/view/') ? FULL_HUNT_JD : 'jobs', items: [] };
    },
    async snapshot() {
      return { url, title: 'page', text: url.includes('/view/') ? FULL_HUNT_JD : url, items: [] };
    },
    click: async () => ({}),
    type: async () => ({}),
    scroll: async () => ({}),
  };
  const out = await runJsonHunt({
    schema: { n: 1, titleIncludes: ['frontend'] },
    existingUrls: ['https://old.example/job'],
    browser,
    llm,
    maxRounds: 6,
  });
  assert.equal(out.added, 1);
  assert.equal(out.jobs[0].company, 'Acme');
  assert.match(out.jobs[0].jdText, /About the role/);
  assert.equal((out.jobs[0].jdText || '').includes('React remote'), false);
});

test('runJsonHunt refuses a summarized jd and waits for the full page', async () => {
  const llm = {
    async prompt() {
      return {
        reply: JSON.stringify({
          action: 'add',
          url: 'https://www.linkedin.com/jobs/view/2',
          title: 'Frontend',
          company: 'Acme',
          jd: 'Seeking a frontend engineer. Requirements: React, TypeScript. Remote.',
        }),
      };
    },
  };
  const browser = {
    async open() {
      return { url: 'https://www.linkedin.com/jobs/search/', title: 'Search', text: 'card teaser', items: [] };
    },
    async snapshot() {
      return { url: 'https://www.linkedin.com/jobs/search/', title: 'Search', text: 'card teaser See more', items: [] };
    },
    click: async () => ({}),
    type: async () => ({}),
    scroll: async () => ({}),
  };
  const out = await runJsonHunt({
    schema: { n: 1, titleIncludes: ['frontend'] },
    browser,
    llm,
    maxRounds: 3,
  });
  assert.equal(out.added, 0);
});

test('runJsonHunt skips a login wall when asked', async () => {
  const llm = {
    async prompt() {
      return { reply: JSON.stringify({ action: 'done', reason: 'skipped' }) };
    },
  };
  const browser = {
    async open(url) {
      return { url, title: 'Sign in', text: 'Sign in to view more jobs', items: [] };
    },
    async snapshot() {
      return {
        url: 'https://www.linkedin.com/login',
        title: 'Sign in',
        text: 'Sign in to view more jobs',
        items: [],
      };
    },
    click: async () => ({}),
    type: async () => ({}),
    scroll: async () => ({}),
  };
  const out = await runJsonHunt({
    schema: { n: 2, sites: ['linkedin'], titleIncludes: ['frontend'] },
    existingUrls: [],
    browser,
    llm,
    onNeedLogin: async () => ({ skipped: true }),
    maxRounds: 4,
  });
  assert.equal(out.added, 0);
});

test('runJsonHunt leaves an already listed company closed', async () => {
  let clicks = 0;
  const llm = {
    async prompt() {
      return { reply: JSON.stringify({ action: 'click', ref: 'e0' }) };
    },
  };
  const browser = {
    async open() {
      return {};
    },
    async snapshot() {
      return {
        url: 'https://www.linkedin.com/jobs/search/',
        title: 'Jobs',
        text: 'Frontend Engineer Acme and other results',
        items: [{ ref: 'e0', role: 'link', name: 'Frontend Engineer Acme', href: 'https://www.linkedin.com/jobs/view/9' }],
      };
    },
    async click() {
      clicks += 1;
    },
    type: async () => ({}),
    scroll: async () => ({}),
  };
  const out = await runJsonHunt({
    schema: { n: 1, sites: ['linkedin'], titleIncludes: ['frontend'] },
    existingJobs: [{ company: 'Acme', url: 'https://www.linkedin.com/jobs/view/1', title: 'Old' }],
    browser,
    llm,
    maxRounds: 2,
  });
  assert.equal(clicks, 0);
  assert.equal(out.added, 0);
});
