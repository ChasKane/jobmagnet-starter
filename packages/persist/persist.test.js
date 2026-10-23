const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magnet-persist-'));
process.env.MAGNET_DB = path.join(tmp, 'magnet.sqlite');
process.env.MAGNET_KNOWLEDGE = tmp;

const persist = require('./src');
const store = require('../../lib/store');

test('sqlite jobs and resume vault round-trip', () => {
  store.close();
  persist.open(process.env.MAGNET_DB);
  const api = persist.nodeStore();
  const job = api.upsertJob({
    id: 'job-x',
    url: 'https://jobs.example.com/apply',
    company: 'Example',
    title: 'Engineer',
  });
  assert.equal(job.company, 'Example');
  assert.equal(api.listJobs().length, 1);
  assert.equal(api.hasJobUrl(job.url), true);
  assert.equal(api.hasJobUrl('https://jobs.example.com/apply'), true);
  assert.equal(api.hasJobUrl('https://jobs.example.com/missing'), false);

  const pdf = path.join(tmp, 'source.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4 test');
  const resume = api.importResume({
    id: 'default',
    label: 'Software Engineer',
    filename: 'source.pdf',
    abs: pdf,
    isDefault: true,
    match: [],
  });
  assert.ok(resume.abs);
  assert.ok(fs.existsSync(resume.abs));
  assert.equal(api.pickResume(job).id, 'default');

  const bundle = api.exportBundle();
  assert.equal(bundle.jobs.length, 1);
  assert.ok(bundle.resumes[0].bytes);

  store.exec('INSERT INTO chats(key, messages, updated_at) VALUES(?,?,?)', [
    job.id,
    JSON.stringify([{ role: 'magnet', kind: 'mail', mailId: 'm1', text: 'Unsure', read: false, at: 1 }]),
    new Date().toISOString(),
  ]);
  const chats = api.listChats();
  assert.equal(chats.some((row) => row.key === job.id && row.messages[0].mailId === 'm1'), true);

  api.writeProcess(job.url, { status: 'submitted' });
  const afterWrite = api.listJobs().find((j) => j.id === 'job-x');
  assert.ok(afterWrite.updatedAt);
  assert.equal(api.getProcess(job.url).updated_at, afterWrite.updatedAt);
  api.upsertJob({ id: 'job-y', url: 'https://jobs.example.com/two', company: 'Two' });
  api.saveChat(job.id, [{ role: 'you', text: 'hello', at: 2 }], { company: 'Example', folded: [] });
  assert.equal(fs.existsSync(path.join(tmp, 'jobs.yaml')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'process.yaml')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'archive', 'chats.json')), false);

  fs.writeFileSync(
    path.join(tmp, 'jobs.yaml'),
    'jobs:\n  - id: from-yaml\n    url: https://jobs.example.com/yaml\n    company: YamlCo\n    title: Eng\n',
    'utf8'
  );
  fs.mkdirSync(path.join(tmp, 'archive'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'archive', 'chats.json'),
    JSON.stringify({
      by_url: {
        'https://jobs.example.com/yaml': { messages: [{ role: 'you', text: 'from-yaml', at: 9 }] },
      },
    }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(tmp, 'process.yaml'),
    'by_url:\n  https://jobs.example.com/yaml:\n    status: submitted\n',
    'utf8'
  );
  persist.migrateFromYaml(tmp);
  assert.equal(api.listJobs().some((j) => j.id === 'from-yaml'), false);
  assert.equal(api.getChat('https://jobs.example.com/yaml')[0].text, 'from-yaml');
  assert.equal(api.getProcess('https://jobs.example.com/yaml').status, 'submitted');

  const dumpDir = path.join(tmp, 'dump');
  persist.exportLiveYaml(dumpDir);
  assert.ok(fs.existsSync(path.join(dumpDir, 'jobs.yaml')));
  assert.ok(fs.existsSync(path.join(dumpDir, 'process.yaml')));
  assert.ok(fs.existsSync(path.join(dumpDir, 'archive', 'chats.json')));
  store.close();
});

test('migrateFromYaml imports jobs when sqlite is empty', () => {
  const db = path.join(tmp, 'empty.sqlite');
  store.close();
  process.env.MAGNET_DB = db;
  persist.open(db);
  fs.writeFileSync(
    path.join(tmp, 'jobs.yaml'),
    'jobs:\n  - id: from-yaml\n    url: https://jobs.example.com/yaml\n    company: YamlCo\n    title: Eng\n',
    'utf8'
  );
  persist.migrateFromYaml(tmp);
  assert.equal(persist.nodeStore().listJobs().some((j) => j.id === 'from-yaml'), true);
  store.close();
});

test('hunt session kv survives restart', () => {
  const db = path.join(tmp, 'hunt-session.sqlite');
  store.close();
  process.env.MAGNET_DB = db;
  persist.open(db);
  const api = persist.nodeStore();
  const row = { schema: { n: 10, sites: ['linkedin'] }, added: ['https://jobs.example/a'], jsonDone: true, need: 10 };
  api.saveHuntSession(row);
  assert.equal(api.getHuntSession().jsonDone, true);
  assert.equal(api.getHuntSession().added[0], 'https://jobs.example/a');
  const bundle = api.exportBundle();
  assert.equal(bundle.huntSession.jsonDone, true);
  api.saveHuntSession(null);
  assert.equal(api.getHuntSession(), null);
  api.importBundle(bundle);
  assert.equal(api.getHuntSession().jsonDone, true);
  api.saveHuntSession(null);
  assert.equal(api.getHuntSession(), null);
  store.close();
});

test('chat ui and pageSubtab survive sqlite and bundle', () => {
  const db = path.join(tmp, 'chat-ui.sqlite');
  store.close();
  process.env.MAGNET_DB = db;
  persist.open(db);
  const api = persist.nodeStore();
  api.saveChat('https://jobs.example.com/a', [{ role: 'you', text: 'hi', at: 1 }], {
    company: 'Acme',
    pageSubtab: 'debug',
  });
  assert.equal(api.getChatState('https://jobs.example.com/a').pageSubtab, 'debug');
  api.saveChatUi({ mru: ['https://jobs.example.com/a', '__mail__'], active: 'https://jobs.example.com/a' });
  assert.deepEqual(api.getChatUi().mru, ['https://jobs.example.com/a']);
  const bundle = api.exportBundle();
  assert.equal(bundle.chats.ui.active, 'https://jobs.example.com/a');
  assert.equal(bundle.chats.by_url['https://jobs.example.com/a'].pageSubtab, 'debug');
  api.saveChatUi({ active: '__ingest__', mru: [] });
  api.importBundle(bundle);
  assert.equal(api.getChatUi().active, 'https://jobs.example.com/a');
  assert.equal(api.getChatState('https://jobs.example.com/a').pageSubtab, 'debug');
  store.close();
});
