const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMagnetApp, createMemoryStore, COMMANDS, isCommand, urlsFromText } = require('./src');

function seedApp(extras = {}) {
  const store = createMemoryStore({
    jobs: [{ id: 'job-1', url: 'https://jobs.contoso.com/apply', company: 'Contoso', title: 'Engineer' }],
    profile: {
      identity: {
        first_name: 'Alex',
        last_name: 'Rivera',
        email: 'chas@example.com',
        portfolio: 'https://example.com',
      },
    },
    resumes: [
      {
        id: 'default',
        label: 'Software Engineer',
        filename: 'resume.pdf',
        isDefault: true,
        match: [],
      },
    ],
    ...extras,
  });
  const fills = [];
  const browser = {
    eval: async (js) => {
      if (String(js).includes('input[type="file"]')) {
        return extras.fileFound || { ok: true, already: false, selector: '#resume' };
      }
      fills.push(js);
      return { ok: true };
    },
    inventory: async () => ({
      fields: [
        { id: 'fullName', label: 'Full name', name: 'fullName' },
        { id: 'pitch', label: 'Why do you want this role? Please tell us in your own words.', tag: 'textarea' },
      ],
    }),
  };
  const files = {
    attach: async ({ selector, resume, magnetInitiated }) => {
      assert.equal(magnetInitiated, true);
      assert.ok(selector);
      assert.equal(resume.id, 'default');
      return { ok: true, selector };
    },
  };
  const llm = {
    prompt: async ({ text }) => ({ reply: `echo:${text}`, drafts: [{ id: 'pitch', text: 'I built ops platforms.' }] }),
  };
  return { app: createMagnetApp({ store, browser, files, llm }), store, fills };
}

test('command catalog is stable', () => {
  assert.ok(COMMANDS.includes('runAutofill'));
  assert.ok(COMMANDS.includes('attachResume'));
  assert.ok(COMMANDS.includes('exportBundle'));
  assert.ok(COMMANDS.includes('listNotices'));
  assert.ok(COMMANDS.includes('markNoticeRead'));
  assert.equal(isCommand('listJobs'), true);
  assert.equal(isCommand('explode'), false);
});

test('list / complete / pass update process and totals', async () => {
  const { app } = seedApp();
  const listed = app.listJobs({ status: 'open' });
  assert.equal(listed.jobs.length, 1);
  assert.equal(listed.jobs[0].company, 'Contoso');
  const before = listed.jobs[0].updatedAt || '';
  const done = await app.completeJob({ id: 'job-1' });
  assert.equal(done.totals.submitted, 1);
  assert.equal(done.record.status, 'submitted');
  const after = app.listJobs({ status: 'all', sort: 'updated' }).jobs[0];
  assert.equal(after.id, 'job-1');
  assert.ok(after.updatedAt);
  assert.ok(!before || after.updatedAt >= before);
  const passed = await app.passJob({
    id: undefined,
    url: 'https://jobs.example.com/x',
  });
  assert.equal(passed.ok, true);
});

test('ingest extracts URLs and attachResume never clicks upload', async () => {
  const { app } = seedApp();
  const ingested = app.ingest({ text: 'try https://boards.greenhouse.io/acme/jobs/1 please' });
  assert.equal(ingested.added.length, 1);
  const attached = await app.attachResume({ id: 'job-1' });
  assert.equal(attached.ok, true);
  assert.equal(attached.already, undefined);
});

test('ingest connect gmail is a mail shortcut', () => {
  const { app } = seedApp();
  const out = app.ingest({ text: 'connect gmail' });
  assert.equal(out.needMailConnect, true);
  assert.equal(out.added.length, 0);
});

test('ingest compiles a search plan instead of adding jobs', () => {
  const { app } = seedApp();
  const out = app.ingest({ text: 'find 8 remote frontend 140k' });
  assert.equal(out.needApproval, true);
  assert.equal(out.schema.n, 8);
  assert.equal(out.added.length, 0);
  assert.ok(out.messages.some((m) => m.plan));
});

test('approveSearch upserts tagged jobs from the search port', async () => {
  const store = createMemoryStore({ jobs: [] });
  const app = createMagnetApp({
    store,
    search: async (schema) => {
      assert.equal(schema.n, 8);
      return {
        jobs: [
          {
            company: 'Acme',
            title: 'Staff Frontend',
            url: 'https://boards.greenhouse.io/acme/jobs/9',
            salary: '160k',
            jdText: 'Build UI.',
            industries: ['software'],
            skills: ['react'],
          },
        ],
      };
    },
  });
  app.ingest({ text: 'find 8 remote frontend' });
  const out = await app.approveSearch({});
  assert.equal(out.added.length, 1);
  assert.equal(out.jobs[0].company, 'Acme');
});

test('approveSearch does not insert a url already in the store', async () => {
  const store = createMemoryStore({
    jobs: [{ id: 'job-1', url: 'https://www.linkedin.com/jobs/view/9', company: 'Acme', title: 'Frontend' }],
  });
  const app = createMagnetApp({
    store,
    search: async () => ({
      jobs: [{ url: 'https://www.linkedin.com/jobs/view/9', company: 'Acme', title: 'Frontend' }],
    }),
  });
  const out = await app.approveSearch({ schema: { n: 5, titleIncludes: ['frontend'] } });
  assert.equal(out.added.length, 0);
  assert.equal(store.listJobs().length, 1);
});

test('approveSearch uses LLM hunt when a hunt browser is provided', async () => {
  let opened = '';
  const store = createMemoryStore({ jobs: [] });
  const app = createMagnetApp({
    store,
    llm: {
      ready: () => true,
      async prompt({ text }) {
        if (/jobs\/view\/9/.test(text)) {
          return {
            reply: JSON.stringify({
              action: 'add',
              url: 'https://www.linkedin.com/jobs/view/9',
              title: 'Frontend',
              company: 'Acme',
              jd: 'React',
            }),
          };
        }
        return { reply: JSON.stringify({ action: 'open', url: 'https://www.linkedin.com/jobs/view/9' }) };
      },
    },
    browserHunt: {
      async open(url) {
        opened = url;
        return { url, title: 'Jobs', text: 'listings', items: [] };
      },
      async snapshot() {
        return { url: opened, title: 'Jobs', text: opened, items: [] };
      },
      click: async () => ({}),
      type: async () => ({}),
      scroll: async () => ({}),
    },
  });
  app.ingest({ text: 'find 4 remote frontend' });
  const out = await app.approveSearch({});
  assert.equal(out.needBoards, false);
  assert.equal(out.added.length, 1);
  assert.equal(out.jobs[0].company, 'Acme');
  assert.match(opened, /linkedin\.com/);
});

test('attachResume reports missing file input without synthesizing a click', async () => {
  const { app } = seedApp({ fileFound: { ok: false } });
  const attached = await app.attachResume({ id: 'job-1' });
  assert.equal(attached.ok, false);
  assert.match(attached.error, /No resume upload/);
});

test('chat and bundle round-trip', async () => {
  const { app } = seedApp();
  const chat = await app.sendChat({ id: 'job-1', text: 'tighten the pitch' });
  assert.equal(chat.ok, true);
  assert.equal(chat.messages.length, 2);
  const exported = app.exportBundle();
  const store2 = createMemoryStore();
  const app2 = createMagnetApp({ store: store2 });
  const imported = app2.importBundle({ bundle: exported.bundle });
  assert.equal(imported.ok, true);
  assert.equal(app2.listJobs().jobs.length, 1);
  assert.equal(app2.getChat({ id: 'job-1' }).messages.length, 2);
});

test('selectChat and ingest compose without a job', async () => {
  const { app } = seedApp();
  const ensured = app.ensureChatTab({ key: 'job-1' });
  assert.equal(ensured.active, '__ingest__');
  assert.ok(ensured.mru.includes('job-1'));
  const selected = app.selectChat({ key: 'job-1', pageSubtab: 'jd' });
  assert.equal(selected.active, 'job-1');
  assert.equal(selected.pageSubtab, 'jd');
  const ingest = await app.sendChat({ id: '__ingest__', text: 'staff engineer remote 180k' });
  assert.equal(ingest.ok, true);
  assert.equal(app.getChatUi().active, '__ingest__');
  const other = app.selectChat({ key: 'job-1' });
  assert.equal(other.pageSubtab, 'jd');
});

test('unsure recruiting mail posts a chat notice with a Gmail link', () => {
  const { app } = seedApp();
  app.completeJob({ id: 'job-1' });
  const out = app.mailImport({
    messages: [
      {
        id: 'm1',
        from: 'jobs@contoso.com',
        subject: 'Thanks for applying',
        text: 'We received your application to Contoso.',
      },
    ],
  });
  assert.equal(out.ok, true);
  assert.equal((out.queued || []).length, 0);
});

test('unsure recruiting mail posts a chat notice with a Gmail link', () => {
  const { app, store } = seedApp();
  app.completeJob({ id: 'job-1' });
  const out = app.mailImport({
    messages: [
      {
        id: 'm-unsure',
        from: 'talent@contoso.com',
        subject: 'Update on your application',
        text: 'Checking in about your candidacy at Contoso for Engineer.',
      },
    ],
  });
  assert.equal((out.queued || []).length, 1);
  const chat = store.getChat('job-1');
  assert.equal(chat.some((m) => m.kind === 'mail' && /m-unsure/.test(m.href || '')), true);
  const inbox = app.listNotices();
  assert.equal(inbox.notices.length, 1);
  app.markNoticeRead({ mailId: 'm-unsure' });
  assert.equal(app.listNotices().notices.length, 0);
});

test('urlsFromText strips trailing punctuation', () => {
  assert.deepEqual(urlsFromText('see https://example.com/job).'), ['https://example.com/job']);
});

test('complete harvests applicant essays and can undo', async () => {
  const { app, store } = seedApp();
  const browser = {
    async inventory() {
      return {
        fields: [
          { id: 'pitch', label: 'Why do you want this role? Please tell us in your own words.', tag: 'textarea' },
        ],
      };
    },
    async eval(js) {
      if (String(js).includes('input[type="file"]')) return { ok: false };
      return 'I want this role because I shipped Lupe with a real ops audit log and intake.';
    },
  };
  const app2 = createMagnetApp({
    store,
    browser,
    files: { attach: async () => ({ ok: true }) },
    llm: {
      async prompt() {
        return {
          reply: '{"reply":"Magnet missed the specific product.","voice_rules":[{"id":"name-the-tool","text":"Describe the tool; do not name it."}],"bindings":[],"experience_updates":[]}',
        };
      },
    },
  });
  const out = await app2.completeJob({ id: 'job-1' });
  assert.equal(out.ok, true);
  assert.equal(out.undo, true);
  assert.ok((out.harvested || []).length >= 1);
  const rec = store.getProcess('https://jobs.contoso.com/apply');
  assert.ok((rec.essays || []).length >= 1);
  const undone = app2.undoOutcome();
  assert.equal(undone.ok, true);
  assert.equal(store.getProcess('https://jobs.contoso.com/apply').status, 'open');
});
