const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createElectronFileInput } = require('./file-input-port');

test('FileInputPort refuses to attach unless Magnet initiated it', async () => {
  const files = createElectronFileInput({
    setFileInput: async () => ({ ok: true }),
    getWebContents: () => ({}),
  });
  const blocked = await files.attach({
    selector: '#resume',
    resume: { abs: '/tmp/r.pdf' },
    magnetInitiated: false,
  });
  assert.equal(blocked.ok, false);
});

test('FileInputPort attaches a vault path when Magnet initiated', async () => {
  const calls = [];
  const files = createElectronFileInput({
    getWebContents: () => ({ id: 1 }),
    setFileInput: async (wc, selector, abs) => {
      calls.push({ selector, abs });
      return { ok: true };
    },
  });
  const out = await files.attach({
    selector: '#resume',
    resume: { abs: '/tmp/vault/default.pdf' },
    magnetInitiated: true,
  });
  assert.equal(out.ok, true);
  assert.equal(calls[0].abs, '/tmp/vault/default.pdf');
});
