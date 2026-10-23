import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelay } from './relay.js';

function harness() {
  const sent = [];
  let relay;
  relay = createRelay({
    async send(text) {
      sent.push(text);
      return { id: `S${sent.length}` };
    },
    defaultWaitMs: 80,
  });
  return { sent, relay };
}

test('status sends once and does not wait', async () => {
  const { sent, relay } = harness();
  const out = await relay.statusMessage({ agent: 'jobmagnet', message: 'Tests passed' });
  assert.deepEqual(out, { status: 'sent' });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Cloud agent · jobmagnet\nTests passed/);
});

test('a reply that arrives during send answers the only open question', async () => {
  const sent = [];
  let relay;
  relay = createRelay({
    async send() {
      sent.push('x');
      relay.pushReply({ text: 'ship it' });
      return { id: 'S1' };
    },
    defaultWaitMs: 5000,
  });
  const out = await relay.ask({ agent: 'api', question: 'Ship the migration?' });
  assert.equal(out.status, 'answered');
  assert.equal(out.reply, 'ship it');
  assert.equal(sent.length, 1);
});

test('a quoted reply stays with its question when two are open', async () => {
  const sent = [];
  let gate;
  const opened = new Promise((resolve) => {
    gate = resolve;
  });
  let relay;
  relay = createRelay({
    async send(text) {
      sent.push(text);
      const id = `S${sent.length}`;
      if (sent.length === 1) {
        gate();
        await new Promise((resolve) => setTimeout(resolve, 30));
      } else {
        relay.pushReply({ text: 'the second one', quotedId: id });
      }
      return { id };
    },
    defaultWaitMs: 200,
  });
  const first = relay.ask({ question: 'First?' });
  await opened;
  const second = await relay.ask({ question: 'Second?' });
  assert.equal(second.status, 'answered');
  assert.equal(second.questionId, 'q2');
  assert.equal(second.reply, 'the second one');
  const pending = await first;
  assert.equal(pending.status, 'pending');
  assert.equal(pending.questionId, 'q1');
});

test('a tagged reply picks the question, and a retry while it is open does not send again', async () => {
  const { sent, relay } = harness();
  const pending = relay.ask({ agent: 'web', question: 'Which color?', waitMs: 400 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const retry = relay.ask({ agent: 'web', question: 'Which color?', waitMs: 400 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
  relay.pushReply({ text: 'q1 blue' });
  assert.equal((await pending).reply, 'blue');
  assert.equal((await retry).reply, 'blue');
});

test('wait returns an answer that lands after the first ask times out', async () => {
  const { relay } = harness();
  const pending = await relay.ask({ question: 'Proceed?', waitMs: 30 });
  assert.equal(pending.status, 'pending');
  const waiting = relay.wait(pending.questionId, 1000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  relay.pushReply({ text: 'yes' });
  const out = await waiting;
  assert.deepEqual(out, { status: 'answered', questionId: pending.questionId, reply: 'yes' });
});
