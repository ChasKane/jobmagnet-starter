const { test } = require('node:test');
const assert = require('node:assert/strict');
const { streamSend, promptText, isActiveRunError } = require('./cursor-agent');

test('active run errors are recognized', () => {
  assert.equal(
    isActiveRunError(new Error('Agent agent-cd1f258c-b9ee-40d7-995e-b351f3907f0b already has active run')),
    true
  );
  assert.equal(isActiveRunError(new Error('nope')), false);
});

test('streamSend cancels and retries once on an active run', async () => {
  let sends = 0;
  const agent = {
    async send() {
      sends += 1;
      if (sends === 1) throw new Error('Agent agent-1 already has active run');
      return {
        async *stream() {},
        async wait() {
          return { result: 'ok' };
        },
      };
    },
    async cancel() {},
  };
  const out = await streamSend(agent, 'hi');
  assert.equal(sends, 2);
  assert.equal(out.text, 'ok');
});

test('streamSend throws when aborted during send', async () => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const agent = {
    send: async () => {
      await hold;
      return {
        async *stream() {},
        async wait() {
          return { result: 'x' };
        },
        async cancel() {},
      };
    },
  };
  const ac = new AbortController();
  const p = streamSend(agent, 'hi', { signal: ac.signal });
  ac.abort();
  release();
  await assert.rejects(p, (err) => err && err.cancelled);
});

test('promptText throws when aborted during send', async () => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const Agent = {
    async create() {
      return {
        send: async () => {
          await hold;
          return {
            async *stream() {},
            async wait() {
              return { result: 'x' };
            },
            async cancel() {},
          };
        },
        async dispose() {},
      };
    },
  };
  const ac = new AbortController();
  const p = promptText(Agent, 'hi', { signal: ac.signal, name: 'test', tools: [] });
  ac.abort();
  release();
  await assert.rejects(p, (err) => err && err.cancelled);
});
