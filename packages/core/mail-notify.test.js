const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('./src/memory-store');
const { mailNotice, targetUrls, notifyQueuedMail, unreadMailNotices, markMailRead } = require('./src/mail-notify');

test('mailNotice carries a Gmail link', () => {
  const notice = mailNotice({ id: 'abc123', subject: 'Update on your application' });
  assert.equal(notice.kind, 'mail');
  assert.match(notice.href, /abc123/);
  assert.match(notice.text, /Update on your application/);
});

test('notifyQueuedMail writes to candidate job chats', () => {
  const store = createMemoryStore({
    jobs: [{ id: 'job-1', url: 'https://jobs.contoso.com/apply', company: 'Contoso' }],
  });
  const out = notifyQueuedMail(store, [
    {
      id: 'm1',
      subject: 'Next steps?',
      candidates: [{ url: 'https://jobs.contoso.com/apply', company: 'Contoso' }],
    },
  ]);
  assert.equal(out.length, 1);
  const chat = store.getChat('job-1');
  assert.equal(chat.length, 1);
  assert.equal(chat[0].kind, 'mail');
  assert.deepEqual(targetUrls({ decision: { url: 'https://a.example' } }), ['https://a.example']);
});

test('unreadMailNotices skips read mail and lists company', () => {
  const store = createMemoryStore({
    jobs: [{ id: 'job-1', url: 'https://jobs.contoso.com/apply', company: 'Contoso' }],
  });
  notifyQueuedMail(store, [{ id: 'm1', subject: 'Ping', candidates: [{ url: 'https://jobs.contoso.com/apply', company: 'Contoso' }] }]);
  const first = unreadMailNotices(store.listChats(), store.listJobs());
  assert.equal(first.length, 1);
  assert.equal(first[0].company, 'Contoso');
  store.saveChat('job-1', markMailRead(store.getChat('job-1'), 'm1'));
  assert.equal(unreadMailNotices(store.listChats(), store.listJobs()).length, 0);
});
