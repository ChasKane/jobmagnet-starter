const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

delete process.env.MAGNET_STORE;
process.env.MAGNET_DB = path.join(os.tmpdir(), `magnet-essay-draft-${process.pid}.sqlite`);
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-essay-draft-${process.pid}`);

const { runEssayTurn } = require('./essay-draft');

function scripted(replies) {
  const prompts = [];
  return {
    prompts,
    async promptText(_agent, prompt) {
      prompts.push(prompt);
      const next = replies[prompts.length - 1];
      return { result: typeof next === 'function' ? next(prompt) : next };
    },
  };
}

test('empty-instruction essays classify once, then the why-role pipe, and standard stays on four stages', async () => {
  const llm = scripted([
    '{"buckets":[{"id":"why","bucket":"why-role"},{"id":"proud","bucket":"standard"}]}',
    JSON.stringify({ reply: 'Named the product.', drafts: [{ id: 'why', text: 'Omg because yall ship the editor.' }] }),
    JSON.stringify({ reply: 'Proud draft.', drafts: [{ id: 'proud', text: 'Page Builder.' }] }),
  ]);
  const out = await runEssayTurn(
    {
      company: 'Gamma',
      title: 'Frontend',
      fields: [
        { id: 'why', label: 'Why Gamma?' },
        { id: 'proud', label: 'What are you proud of?' },
      ],
      jd: { text: 'Collaborative documents.' },
      voice: 'Be short.',
    },
    { promptText: llm.promptText, Agent: {}, extractText: (r) => r.result, requestId: 'route' }
  );
  assert.equal(llm.prompts.length, 3);
  assert.match(llm.prompts[0], /Classify every essay question/);
  assert.match(llm.prompts[1], /coolest solution in the industry/);
  assert.doesNotMatch(llm.prompts[1], /## Stage 1 Strategy/);
  assert.match(llm.prompts[2], /## Stage 1 Strategy/);
  assert.deepEqual(
    out.drafts.map((row) => row.id),
    ['why', 'proud']
  );
});

test('advice does not classify or replace the four-stage turn', async () => {
  const llm = scripted([
    JSON.stringify({ reply: 'Keep the joke.', drafts: [] }),
  ]);
  const out = await runEssayTurn(
    {
      company: 'Gamma',
      title: 'Frontend',
      instruction: 'how might I end this draft?',
      fields: [{ id: 'why', label: 'Why Gamma?', current: 'https://example.com' }],
      jd: { text: 'Editor.' },
      voice: 'Be short.',
    },
    { promptText: llm.promptText, Agent: {}, extractText: (r) => r.result, requestId: 'advice' }
  );
  assert.equal(llm.prompts.length, 1);
  assert.match(llm.prompts[0], /## Stage 1 Strategy/);
  assert.doesNotMatch(llm.prompts[0], /Classify every essay question/);
  assert.equal(out.drafts.length, 0);
  assert.match(out.reply, /Keep the joke/);
});
