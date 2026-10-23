const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runIngestHunt, huntPrompt } = require('./hunt-sdk');

test('huntPrompt tells the model not to ask for passwords', () => {
  const text = huntPrompt({
    plan: { n: 3, titleIncludes: ['frontend'], sites: ['linkedin'] },
    starts: [{ site: 'linkedin', url: 'https://www.linkedin.com/jobs/search/' }],
    existing: [],
    status: { added: 0, need: 3 },
    round: 0,
    last: '',
  });
  assert.match(text, /never ask for a password/i);
  assert.match(text, /linkedin/i);
  assert.match(text, /dupe/i);
  assert.match(text, /one listing per company/i);
  assert.match(text, /companyHeld/i);
  assert.match(text, /never write, paraphrase, or summarize/i);
  assert.match(text, /leave jd empty/i);
  assert.doesNotMatch(text, /Already listed/i);
});

test('hunt tools keep page driving off the Apply surface', () => {
  const { huntTools } = require('./hunt-sdk');
  const tools = huntTools({ port: 9, traces: [], call: async () => ({}) });
  assert.match(tools.open_page.description, /hidden hunt browser/i);
  assert.match(tools.need_sign_in.description, /shows the login page only/i);
});

test('runIngestHunt stops once status hits n', async () => {
  let added = 0;
  const call = async (op) => {
    if (op === 'begin') return { added: 0, need: 2, jobs: [], urls: [] };
    if (op === 'status') return { added, need: 2, jobs: [], urls: [], dupes: 0, jds: 0 };
    return { added, need: 2 };
  };
  const out = await runIngestHunt(
    { schema: { n: 2, titleIncludes: ['frontend'] }, existingUrls: [], controlPort: 9 },
    {
      Agent: {},
      promptText: async () => {
        added = 2;
        return { result: 'Added 2 of 2.' };
      },
      extractText: (r) => r.result,
      huntCall: call,
    }
  );
  assert.equal(out.ok, true);
  assert.equal(out.added, 2);
  assert.match(out.reply, /2 new listing/);
});

test('runIngestHunt resumes from saved href and round', async () => {
  const ops = [];
  let added = 3;
  const call = async (op, body) => {
    ops.push({ op, body });
    if (op === 'begin') {
      return {
        added: 3,
        need: 8,
        jobs: [],
        urls: [],
        jsonDone: true,
        href: 'https://www.linkedin.com/jobs/search/?f_TPR=r86400',
        round: 2,
        last: 'still hunting greenhouse',
        resumed: true,
      };
    }
    if (op === 'status') return { added, need: 8, jobs: [], urls: [], dupes: 0, jds: 0 };
    return { added, need: 8 };
  };
  const prompts = [];
  const out = await runIngestHunt(
    { schema: { n: 8, titleIncludes: ['frontend'] }, controlPort: 9, resume: true },
    {
      Agent: {},
      promptText: async (_agent, prompt) => {
        prompts.push(prompt);
        added = 8;
        return { result: 'Added 8 of 8.' };
      },
      extractText: (r) => r.result,
      huntCall: call,
    }
  );
  assert.equal(out.ok, true);
  assert.equal(out.added, 8);
  assert.equal(ops[0].op, 'begin');
  assert.equal(ops[0].body.resume, true);
  assert.ok(ops.some((row) => row.op === 'open' && row.body && row.body.url.includes('f_TPR=r86400')));
  assert.match(prompts[0], /Round 3/);
  assert.match(prompts[0], /still hunting greenhouse/);
});

test('runIngestHunt throws when aborted after a prompt', async () => {
  const ac = new AbortController();
  const call = async (op) => {
    if (op === 'begin') return { added: 0, need: 4, jobs: [], urls: [] };
    return { added: 0, need: 4, jobs: [], urls: [], dupes: 0, jds: 0 };
  };
  await assert.rejects(
    runIngestHunt(
      { schema: { n: 4, titleIncludes: ['frontend'] }, existingUrls: [], controlPort: 9 },
      {
        Agent: {},
        promptText: async () => {
          ac.abort();
          return { result: 'still hunting' };
        },
        extractText: (r) => r.result,
        huntCall: call,
        signal: ac.signal,
      }
    ),
    (err) => err && err.cancelled
  );
});
