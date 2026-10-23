const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDrafts, createFetchLlm } = require('./src/fetch-client');

test('parseDrafts reads Magnet JSON', () => {
  const out = parseDrafts('{"reply":"ok","drafts":[{"id":"q1","text":"hello"}]}');
  assert.equal(out.reply, 'ok');
  assert.equal(out.drafts[0].id, 'q1');
});

test('HTTPS prompt pastes store answers before the model on reuse', async () => {
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    seen.push(JSON.parse(opts.body));
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: '{"reply":"ok","drafts":[]}' } }] };
      },
    };
  };
  try {
    const llm = createFetchLlm({ apiKey: 'k', url: 'https://example.test/v1/chat/completions' });
    await llm.prompt({
      text: 'use what I wrote at Stripe',
      store: {
        searchAnswers() {
          return [{ company: 'Stripe', label: 'Why us', text: 'I shipped billing ops.' }];
        },
      },
    });
    const user = seen[0].messages.find((m) => m.role === 'user');
    assert.match(user.content, /billing ops/);
  } finally {
    globalThis.fetch = prev;
  }
});
