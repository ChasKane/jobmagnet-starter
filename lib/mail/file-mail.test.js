const { test } = require('node:test');
const assert = require('node:assert/strict');
const { archiveMessages, ARCHIVE_INBOX_Q, ARCHIVE_LABELS } = require('./gmail');
const { scanReply, shouldArchiveRow, collectFiling, processMessages } = require('./scan');
const { notificationText, notificationScript } = require('./notify-os');
const { scopeAllowsModify } = require('./oauth');

test('archiveMessages marks read and removes the inbox label', async () => {
  const calls = [];
  const out = await archiveMessages('tok', ['a', 'b', 'a'], {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 204, text: async () => '' };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.archived, 2);
  assert.match(calls[0].url, /\/messages\/batchModify$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.headers.Authorization, /Bearer tok/);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.ids, ['a', 'b']);
  assert.deepEqual(body.removeLabelIds, ['UNREAD', 'INBOX']);
  assert.deepEqual(ARCHIVE_LABELS, ['UNREAD', 'INBOX']);
  assert.match(ARCHIVE_INBOX_Q, /in:inbox/);
  assert.match(ARCHIVE_INBOX_Q, /we've received your application/);
  assert.match(ARCHIVE_INBOX_Q, /we've decided not to/);
});

test('cached receipts and rejects are archived without another body read', async () => {
  const reads = [];
  const index = {
    r1: { verdict: 'received', reason: 'received' },
    x1: { verdict: 'reject' },
    i1: { verdict: 'not_reject', reason: 'interview' },
  };
  const filing = collectFiling(index, []);
  assert.equal(filing.get('r1'), 'received');
  assert.equal(filing.get('x1'), 'reject');
  assert.equal(filing.has('i1'), false);
  assert.equal(shouldArchiveRow(index.r1), true);
  assert.equal(shouldArchiveRow(index.i1), false);

  const out = await processMessages(['r1', 'x1'], async (id) => {
    reads.push(id);
    return { id, from: '', subject: '', text: '', date: '' };
  }, [], index);
  assert.deepEqual(reads, []);
  assert.equal(out.archive.length, 0);
  assert.equal(out.skipped, 2);
});

test('archiveMessages asks for a new sign-in when Gmail refuses', async () => {
  const out = await archiveMessages('tok', ['a'], {
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: { message: 'insufficient permissions' } }),
    }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.needReconnect, true);
  assert.equal(out.archived, 0);
});

test('scan reply names archived mail and other notifications', () => {
  const reply = scanReply({
    scanned: 8,
    archivedRejects: 2,
    archivedReceipts: 1,
    notified: 1,
    queued: 1,
  });
  assert.match(reply, /Scanned 8/);
  assert.match(reply, /Archived 2 rejections and 1 application receipt out of your inbox/);
  assert.doesNotMatch(reply, /Marked read/);
  assert.match(reply, /Notified you about 1 other email/);
  assert.match(reply, /1 still needs a job match/);
});

test('scan reply asks for mailbox permission instead of claiming an archive', () => {
  const reply = scanReply({
    scanned: 3,
    archivedRejects: 1,
    archivedReceipts: 2,
    notified: 0,
    queued: 0,
    needReconnect: true,
  });
  assert.match(reply, /ready to archive/);
  assert.match(reply, /connect gmail/);
  assert.doesNotMatch(reply, /Marked read/);
});

test('one other email becomes a single notification', () => {
  const note = notificationText([{ id: 'm1', subject: 'Phone screen', from: 'Ada <ada@acme.com>', href: 'https://mail.google.com/mail/u/0/#inbox/m1' }]);
  assert.equal(note.title, 'JobMagnet');
  assert.match(note.body, /Phone screen/);
  assert.match(note.body, /Ada/);
  assert.match(notificationScript([{ subject: 'Phone screen', from: 'Ada' }]), /display notification/);
});

test('readonly gmail scope cannot archive', () => {
  assert.equal(scopeAllowsModify('https://www.googleapis.com/auth/gmail.readonly'), false);
  assert.equal(scopeAllowsModify(''), false);
  assert.equal(scopeAllowsModify('https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email'), true);
});
