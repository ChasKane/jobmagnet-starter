const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatAlertChat, chatFolds, shouldPing, takeNewAlerts, collectAlertFindings, silentFail } = require('./attention');

test('resume and JD ping only on failure or gotchas', () => {
  assert.equal(shouldPing('jd', { ok: true }), false);
  assert.equal(shouldPing('resume', { ok: true }), false);
  assert.equal(shouldPing('jd', { ok: false, error: 'nope' }), true);
  assert.equal(shouldPing('resume', { ok: true }, { hasAlerts: true }), true);
  assert.equal(shouldPing('essays', { ok: true }), true);
  assert.equal(shouldPing('all', { ok: true, cancelled: true }), false);
});

test('silentFail skips operational errors without a reply', () => {
  assert.equal(silentFail({ ok: false, error: 'boom', reply: '' }), true);
  assert.equal(silentFail({ ok: false, reply: 'Essay draft failed — retry' }), false);
  assert.equal(silentFail({ ok: true, reply: 'Okay.' }), false);
});

test('formatAlertChat lists gotcha summaries once', () => {
  assert.equal(formatAlertChat([]), '');
  assert.equal(
    formatAlertChat([{ summary: 'Cover-letter canary ("so we know you read this")' }]),
    'Gotcha — Cover-letter canary ("so we know you read this")'
  );
  assert.equal(
    formatAlertChat([{ summary: 'Hijack' }, { summary: 'Canary' }]),
    'Gotchas\n• Hijack\n• Canary'
  );
});

test('chatFolds keeps hard fails only', () => {
  const folds = chatFolds({ ok: false, error: 'Resume file missing' }, {});
  assert.deepEqual(folds, [{ level: 'error', label: 'error', text: 'Resume file missing' }]);
});

test('takeNewAlerts remembers what already hit chat', () => {
  const tab = { surfacedAlerts: [] };
  const first = takeNewAlerts(tab, [{ kind: 'cover_trap', id: 'cover-so-we-know', summary: 'Canary' }]);
  assert.equal(first.length, 1);
  const again = takeNewAlerts(tab, [{ kind: 'cover_trap', id: 'cover-so-we-know', summary: 'Canary' }]);
  assert.equal(again.length, 0);
});

test('collectAlertFindings merges JD findings and form canaries', () => {
  const tab = {
    jd: {
      findings: {
        findings: [{ kind: 'llm_hijack', id: 'if-you-are-llm', summary: 'JD addresses LLMs directly' }],
      },
    },
    debugFields: [{ id: 'q1', label: 'Secret word from the posting' }],
  };
  const alerts = collectAlertFindings(tab);
  assert.equal(alerts.some((f) => f.id === 'if-you-are-llm'), true);
  assert.equal(alerts.some((f) => f.id === 'form-canary'), true);
});
