const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guide = require('./setup-guide');

const empty = {
  apiKey: false,
  gmailClientId: false,
  gmailClientSecret: false,
  gmailConnected: false,
  resumeCount: 0,
  storyCount: 0,
  storiesDone: false,
  port: 3872,
};

test('setup walks key, gmail client, gmail connect, resume, then stories', () => {
  assert.equal(guide.nextStep(empty), 'apiKey');
  assert.equal(guide.nextStep({ ...empty, apiKey: true }), 'gmailClient');
  assert.equal(
    guide.nextStep({ ...empty, apiKey: true, gmailClientId: true, gmailClientSecret: true }),
    'gmailConnect'
  );
  assert.equal(
    guide.nextStep({
      ...empty,
      apiKey: true,
      gmailClientId: true,
      gmailClientSecret: true,
      gmailConnected: true,
    }),
    'resume'
  );
  assert.equal(
    guide.nextStep({
      ...empty,
      apiKey: true,
      gmailClientId: true,
      gmailClientSecret: true,
      gmailConnected: true,
      resumeCount: 1,
    }),
    'stories'
  );
  assert.equal(
    guide.nextStep({
      ...empty,
      apiKey: true,
      gmailClientId: true,
      gmailClientSecret: true,
      gmailConnected: true,
      resumeCount: 1,
      storyCount: 3,
    }),
    null
  );
});

test('api key step stores a token and refuses a Google secret', () => {
  const key = 'crsr_' + 'a'.repeat(24);
  const saved = guide.interpret(key, empty);
  assert.equal(saved.env.CURSOR_API_KEY, key);
  const google = guide.interpret('GOCSPX-' + 'b'.repeat(20), empty);
  assert.equal(google.env, undefined);
  assert.match(google.note, /Cursor API key/);
});

test('ask-card answers still yield the pasted key', () => {
  const key = 'key_' + 'c'.repeat(24);
  const saved = guide.interpret(`Paste your Cursor API key\n→ ${key}`, empty);
  assert.equal(saved.env.CURSOR_API_KEY, key);
});

test('gmail client step splits id and secret', () => {
  const status = { ...empty, apiKey: true };
  const both = guide.interpret(
    '123-abc.apps.googleusercontent.com GOCSPX-secretvalue123456',
    status
  );
  assert.equal(both.env.GMAIL_CLIENT_ID, '123-abc.apps.googleusercontent.com');
  assert.equal(both.env.GMAIL_CLIENT_SECRET, 'GOCSPX-secretvalue123456');
  const connect = guide.interpret('Connect Gmail', {
    ...status,
    gmailClientId: true,
    gmailClientSecret: true,
  });
  assert.equal(connect.needConnect, true);
});

test('resume step opens the file chooser from the button label', () => {
  const status = {
    ...empty,
    apiKey: true,
    gmailClientId: true,
    gmailClientSecret: true,
    gmailConnected: true,
  };
  const pressed = guide.interpret('Add your resume\n→ Choose resume file', status);
  assert.equal(pressed.needResume, true);
});

test('stories parse employer-first lines and allow an early stop', () => {
  const status = {
    ...empty,
    apiKey: true,
    gmailClientId: true,
    gmailClientSecret: true,
    gmailConnected: true,
    resumeCount: 1,
  };
  const filed = guide.interpret('At Northwind I shipped the checkout rewrite and owned the empty states.', status);
  assert.equal(filed.fileStory.employer, 'Northwind');
  assert.match(filed.fileStory.text, /checkout rewrite/);
  const early = guide.interpret('done', { ...status, storyCount: 0 });
  assert.equal(early.storiesDone, undefined);
  const stop = guide.interpret('done', { ...status, storyCount: 1 });
  assert.equal(stop.storiesDone, true);
});

test('intro names the four steps and the redirect port', () => {
  const view = guide.render(empty, { intro: true });
  assert.match(view.reply, /Cursor API key/);
  assert.match(view.reply, /Gmail/);
  assert.match(view.reply, /resume/);
  assert.match(view.reply, /story cards/);
  assert.equal(view.asks[0].id, 'setup-api-key');
  const gmail = guide.render({ ...empty, apiKey: true });
  assert.match(gmail.reply, /127\.0\.0\.1:3872\/mail\/oauth\/callback/);
});

test('writeEnv upserts keys without dropping neighbors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magnet-setup-'));
  const prev = process.env.CURSOR_API_KEY;
  try {
    fs.writeFileSync(path.join(root, '.env'), 'OTHER=keep\nCURSOR_API_KEY=old\n');
    guide.writeEnv({ CURSOR_API_KEY: 'crsr_newkeynewkeynewkey' }, root);
    const text = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.match(text, /OTHER=keep/);
    assert.match(text, /CURSOR_API_KEY=crsr_newkeynewkeynewkey/);
    assert.equal(process.env.CURSOR_API_KEY, 'crsr_newkeynewkeynewkey');
    guide.markStoriesDone(root);
    assert.equal(guide.readFlags(root).storiesDone, true);
  } finally {
    if (prev == null) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
