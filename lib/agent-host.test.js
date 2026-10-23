const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.MAGNET_DB = path.join(os.tmpdir(), `magnet-host-${process.pid}.sqlite`);
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-host-${process.pid}`);

const { createHostRuntime, parseLine } = require('./agent-host');

function fakeCursor() {
  let created = 0;
  return {
    created: () => created,
    createAgent: async () => {
      created += 1;
      return { agentId: 'agent-' + created };
    },
    resumeAgent: async (_A, id) => ({ agentId: id }),
    agentIdOf: (a) => a.agentId,
    streamSend: async (agent, text) => ({ result: { result: text }, text, agentId: agent.agentId }),
    isActiveRunError: (err) => /already has active run/i.test(String((err && err.message) || err || '')),
    promptText: async (_A, prompt) => ({ result: prompt }),
    extractText: (r) => (r && r.result) || '',
  };
}

function fakeAgent() {
  return {
    async create() {
      return { agentId: 'x' };
    },
    async resume(id) {
      return { agentId: id };
    },
  };
}

test('parseLine skips junk', () => {
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('not-json'), null);
  assert.equal(parseLine('{"op":"ping"}').op, 'ping');
});

test('model switch keeps the same agentId', async () => {
  const cursor = fakeCursor();
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  const created = await dispatch({ op: 'create', id: 1, key: 'tab-1' });
  assert.equal(created.agentId, 'agent-1');
  const first = await dispatch({ op: 'send', id: 2, key: 'tab-1', text: 'hi', model: { id: 'grok-4.6' } });
  const second = await dispatch({ op: 'send', id: 3, key: 'tab-1', text: 'again', model: { id: 'gpt-5.6' } });
  assert.equal(first.agentId, 'agent-1');
  assert.equal(second.agentId, 'agent-1');
  assert.equal(cursor.created(), 1);
});

test('a missing resumed agent is created again', async () => {
  const cursor = fakeCursor();
  cursor.resumeAgent = async () => {
    throw new Error('Agent agent-stale not found');
  };
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  const created = await dispatch({ op: 'create', id: 1, key: 'tab-stale', agentId: 'agent-stale' });
  assert.equal(created.agentId, 'agent-1');
  assert.equal(cursor.created(), 1);
});

test('yeet rebuild mints a new agent', async () => {
  const cursor = fakeCursor();
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  await dispatch({ op: 'create', id: 1, key: 'tab-1' });
  const rebuilt = await dispatch({ op: 'create', id: 2, key: 'tab-1', forceCreate: true });
  assert.equal(rebuilt.agentId, 'agent-2');
  assert.equal(cursor.created(), 2);
});

test('cancel by key aborts send and does not complete it as ok', async () => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const cursor = fakeCursor();
  cursor.streamSend = async (_agent, _text, extra) => {
    await hold;
    if (extra && extra.signal && extra.signal.aborted) {
      const err = new Error('fill cancelled');
      err.cancelled = true;
      throw err;
    }
    return { text: 'hi', agentId: 'agent-1', result: {} };
  };
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  await dispatch({ op: 'create', id: 1, key: 'tab-1' });
  const sendP = dispatch({ op: 'send', id: 9, key: 'tab-1', text: 'hello' });
  const cancelOut = await dispatch({ op: 'cancel', id: 10, key: 'tab-1' });
  assert.equal(cancelOut.id, 10);
  assert.equal(cancelOut.ok, true);
  release();
  const out = await sendP;
  assert.equal(out.id, 9);
  assert.equal(out.cancelled, true);
});

test('fill-review invoke sends on a review session key', async () => {
  const cursor = fakeCursor();
  const sends = [];
  cursor.streamSend = async (agent, text) => {
    sends.push(String(text || ''));
    return {
      text: '{"reply":"ok","fills":[{"id":"s","value":"UW"}],"asks":[]}',
      agentId: agent.agentId,
      result: {},
    };
  };
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  const out = await dispatch({
    op: 'invoke',
    id: 3,
    name: 'fill-review',
    key: 'tab-1:review',
    payload: { residuals: [{ id: 's', label: 'School' }], instruction: 'UW', focus_id: 's' },
  });
  assert.equal(out.op, 'done');
  assert.equal(sends.length, 1);
  assert.equal(out.result.fills[0].value, 'UW');
});

test('mint then essay invoke sends one chat turn', async () => {
  const cursor = fakeCursor();
  const sends = [];
  cursor.streamSend = async (agent, text) => {
    sends.push(String(text || ''));
    return {
      text: JSON.stringify({ reply: 'Keep those two lines.', drafts: [] }),
      agentId: agent.agentId,
      result: {},
    };
  };
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  await dispatch({ op: 'create', id: 1, key: 'tab-essay', snapshot: 'seed context — do not reply yet' });
  const afterMint = sends.length;
  const out = await dispatch({
    op: 'invoke',
    id: 2,
    name: 'essay',
    key: 'tab-essay',
    payload: {
      tabId: 'tab-essay',
      agentId: 'agent-1',
      instruction: 'how might I end this draft?',
      fields: [{ id: 'q1', label: 'Why', current: 'joke\nhttps://example.com' }],
      jd: { text: 'Engineer' },
      bodies: [],
      voice: 'Be short.',
    },
  });
  assert.equal(out.op, 'done');
  assert.equal(sends.length, afterMint + 1);
  assert.match(sends[sends.length - 1], /Stage 1 Strategy/);
  assert.match(sends[sends.length - 1], /how might I end this draft/);
  assert.equal((out.result && out.result.drafts || []).length, 0);
  assert.match((out.result && out.result.reply) || '', /Keep those two lines/);
});

test('overlapping sends on one key wait their turn', async () => {
  let current = 0;
  let max = 0;
  const cursor = fakeCursor();
  cursor.streamSend = async (agent) => {
    current += 1;
    max = Math.max(max, current);
    await new Promise((r) => setTimeout(r, 20));
    current -= 1;
    return { text: 'ok', agentId: agent.agentId, result: {} };
  };
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  await dispatch({ op: 'create', id: 1, key: 'tab-lock' });
  const first = dispatch({ op: 'send', id: 2, key: 'tab-lock', text: 'one' });
  const second = dispatch({ op: 'send', id: 3, key: 'tab-lock', text: 'two' });
  await Promise.all([first, second]);
  assert.equal(max, 1);
});

test('active run remints and retries the send', async () => {
  const cursor = fakeCursor();
  let sends = 0;
  cursor.streamSend = async (agent, text) => {
    sends += 1;
    if (agent.agentId === 'agent-1') {
      throw new Error('Agent agent-cd1f258c-b9ee-40d7-995e-b351f3907f0b already has active run');
    }
    return { text: String(text || ''), agentId: agent.agentId, result: {} };
  };
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  await dispatch({ op: 'create', id: 1, key: 'tab-stuck' });
  const out = await dispatch({ op: 'send', id: 2, key: 'tab-stuck', text: 'retry' });
  assert.equal(out.op, 'done');
  assert.equal(out.agentId, 'agent-2');
  assert.equal(out.text, 'retry');
  assert.ok(sends >= 2);
  assert.equal(cursor.created(), 2);
});

test('cancel by key aborts ingest invoke', async () => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const cursor = fakeCursor();
  cursor.promptText = async (_A, _prompt, extra) => {
    await hold;
    if (extra && extra.signal && extra.signal.aborted) {
      const err = new Error('fill cancelled');
      err.cancelled = true;
      throw err;
    }
    return { result: 'ok' };
  };
  const { dispatch } = createHostRuntime({
    Agent: fakeAgent(),
    cursor,
    extractText: cursor.extractText,
    emit: () => {},
  });
  const invokeP = dispatch({
    op: 'invoke',
    id: 21,
    name: 'ingest',
    key: '__ingest__',
    payload: { message: 'find remote frontend' },
  });
  const cancelOut = await dispatch({ op: 'cancel', id: 22, key: '__ingest__' });
  assert.equal(cancelOut.ok, true);
  release();
  const out = await invokeP;
  assert.equal(out.id, 21);
  assert.equal(out.cancelled, true);
});
