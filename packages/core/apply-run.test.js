const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runPortableAutofill, attachBytesScript, VERIFY_FILE_SCRIPT } = require('./src/apply-run');
const { createMemoryStore } = require('./src/memory-store');

test('portable autofill classifies essays and fills static fields', async () => {
  const store = createMemoryStore({
    profile: {
      identity: { first_name: 'Alex', last_name: 'Rivera', email: 'chas@example.com', legal_name: 'Alex Rivera' },
    },
  });
  const evals = [];
  const browser = {
    async inventory() {
      return {
        fields: [
          { id: 'fullName', label: 'Full name' },
          { id: 'pitch', label: 'Why do you want this role? Tell us in your own words.' },
        ],
      };
    },
    async eval(js) {
      evals.push(String(js).slice(0, 80));
      return { ok: true };
    },
  };
  const out = await runPortableAutofill({
    job: { id: 'j', url: 'https://jobs.example.com/x', hostname: 'jobs.example.com' },
    rec: {},
    browser,
    store,
    llm: {
      async prompt() {
        return { drafts: [{ id: 'pitch', text: 'I ship ops platforms.' }], reply: 'Drafted.' };
      },
    },
    stage: 'all',
  });
  assert.ok(out.filled.some((f) => f.id === 'fullName' && /Alex/.test(f.value)));
  assert.ok(out.leftovers.some((f) => f.id === 'pitch') || out.drafts.some((d) => d.id === 'pitch'));
  assert.ok(attachBytesScript('#r', 'r.pdf', 'application/pdf', 'AAAA').includes('DataTransfer'));
  assert.match(VERIFY_FILE_SCRIPT, /stillUpload/);
});

test('Contoso fixture: name+url fill, pitch leftover, retrieve ids on essays', async () => {
  const store = createMemoryStore({
    profile: {
      identity: {
        first_name: 'Alex',
        last_name: 'Rivera',
        legal_name: 'Alex Rivera',
        portfolio: 'https://example.com',
        email: 'chas@example.com',
      },
    },
    graph: {
      cards: [{ id: 'card_ops', employer: 'Freelance', claim: 'Shipped an ops platform' }],
      card_tags: [{ card_id: 'card_ops', tag: 'ops-platform' }],
      bindings: [{ id: 'b1', question_shape: 'why-us', tag: 'ops-platform' }],
    },
  });
  let essayPayload = null;
  const browser = {
    async inventory() {
      return {
        fields: [
          { id: 'fullName', label: 'Full name' },
          { id: 'portfolio', label: 'Portfolio URL' },
          { id: 'pitch', label: 'Why do you want this role? Please tell us in your own words.' },
          { id: 'resume', label: 'Resume', type: 'file' },
        ],
      };
    },
    async eval() {
      return { ok: true };
    },
  };
  const out = await runPortableAutofill({
    job: { id: 'contoso', url: 'https://jobs.contoso.test/apply', hostname: 'jobs.contoso.test', company: 'Contoso' },
    rec: {},
    browser,
    store,
    llm: {
      async prompt(payload) {
        essayPayload = payload;
        return { drafts: [], reply: '' };
      },
    },
    stage: 'all',
  });
  assert.ok(out.filled.some((f) => f.id === 'fullName'));
  assert.ok(out.filled.some((f) => f.id === 'portfolio'));
  assert.ok(out.leftovers.some((f) => f.id === 'pitch'));
  assert.ok(essayPayload);
  assert.ok(Array.isArray(essayPayload.retrieveCardIds));
  assert.match(VERIFY_FILE_SCRIPT, /stillUpload/);
});

test('cover letter and anything-else boxes are typed, not drafted', async () => {
  const store = createMemoryStore({ profile: { identity: { first_name: 'Alex', last_name: 'Rivera' } } });
  const scripts = [];
  let prompted = null;
  const browser = {
    async inventory() {
      return {
        fields: [
          { id: 'cover', label: 'Cover letter', tag: 'textarea', type: 'textarea' },
          { id: 'else', label: "Anything else you'd like us to know?", tag: 'textarea', type: 'textarea' },
          { id: 'why', label: 'Why do you want this role? Tell us in your own words.', tag: 'textarea', type: 'textarea' },
        ],
      };
    },
    async eval(js) {
      scripts.push(String(js));
      return { ok: true };
    },
  };
  const out = await runPortableAutofill({
    job: { id: 'j', url: 'https://jobs.example.com/x', company: 'Acme' },
    rec: {},
    browser,
    store,
    llm: {
      async prompt(payload) {
        prompted = payload;
        return { drafts: [{ id: 'why', text: 'The unsolved part is the work.' }] };
      },
    },
    stage: 'essays',
  });
  assert.ok(prompted);
  assert.equal(prompted.mode, 'why-role');
  assert.match(prompted.prompt || '', /coolest solution in the industry/);
  assert.deepEqual(
    (prompted.fields || []).map((f) => f.id),
    ['why']
  );
  assert.ok(out.drafts.some((d) => d.id === 'cover' && /I have friends everywhere/.test(d.text)));
  assert.ok(out.drafts.some((d) => d.id === 'else' && /Give me a problem no one has solved yet/.test(d.text)));
  assert.ok(scripts.some((js) => js.includes('I have friends everywhere') && js.includes('cover')));
  assert.equal(out.drafts.filter((d) => d.id === 'cover').length, 1);
});

test('a cover letter page does not call the model', async () => {
  const store = createMemoryStore({ profile: {} });
  const scripts = [];
  const browser = {
    async inventory() {
      return { fields: [{ id: 'cover', label: 'Please paste your cover letter', tag: 'textarea', type: 'textarea' }] };
    },
    async eval(js) {
      scripts.push(String(js));
      return { ok: true };
    },
  };
  const out = await runPortableAutofill({
    job: { id: 'j', url: 'https://jobs.example.com/y', company: 'Acme' },
    rec: {},
    browser,
    store,
    llm: {
      async prompt() {
        throw new Error('model should not draft a cover letter');
      },
    },
    stage: 'essays',
  });
  assert.equal(out.ok, true);
  assert.equal(out.drafts.length, 1);
  assert.match(out.drafts[0].text, /Mystical Yoga Farm/);
  assert.ok(scripts.some((js) => js.includes('Mystical Yoga Farm')));
});

test('harvestPortable keeps long applicant essays', async () => {
  const { harvestPortable } = require('./src/apply-run');
  const browser = {
    async inventory() {
      return {
        fields: [
          { id: 'pitch', label: 'Why do you want this role? Please tell us in your own words.', tag: 'textarea' },
        ],
      };
    },
    async eval() {
      return 'I want this role because I shipped Lupe with a real ops audit log and intake.';
    },
  };
  const out = await harvestPortable({
    browser,
    job: { company: 'Contoso', url: 'https://jobs.contoso.test/apply' },
  });
  assert.equal(out.essays.length, 1);
  assert.match(out.essays[0].text, /Lupe/);
});
