import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelay } from './relay.js';
import { createApp } from './server.js';

function parseBody(contentType, text) {
  if ((contentType || '').includes('application/json')) return JSON.parse(text);
  const lines = [...text.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).filter((line) => line && line !== '[DONE]');
  if (!lines.length) throw new Error(`no rpc payload in ${contentType}: ${text.slice(0, 400)}`);
  return JSON.parse(lines[lines.length - 1]);
}

async function rpc(base, token, body) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, payload: parseBody(res.headers.get('content-type'), text) };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('health is public and mcp rejects a missing token', async () => {
  const relay = createRelay({
    async send() {
      return { id: 'S1' };
    },
  });
  const app = createApp({ token: 'secret', relay, status: () => 'open' });
  const { server, base } = await listen(app);
  try {
    const health = await fetch(`${base}/health`);
    assert.deepEqual(await health.json(), { whatsapp: 'open' });
    const denied = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    });
    assert.equal(denied.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a cloud-agent client can list the tools and send a status', async () => {
  const sent = [];
  const relay = createRelay({
    async send(text) {
      sent.push(text);
      return { id: 'S1' };
    },
  });
  const app = createApp({ token: 'secret', relay, status: () => 'open' });
  const { server, base } = await listen(app);
  try {
    const init = await rpc(base, 'secret', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });
    assert.equal(init.status, 200);
    assert.match(init.payload.result.instructions, /whatsapp_ask/);
    assert.equal(init.payload.result.serverInfo.name, 'agent-whatsapp');

    await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    const listed = await rpc(base, 'secret', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = listed.payload.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ['whatsapp_ask', 'whatsapp_status', 'whatsapp_wait']);

    const call = await rpc(base, 'secret', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'whatsapp_status', arguments: { message: 'Opening the PR', agent: 'jobmagnet' } },
    });
    const block = call.payload.result.content[0].text;
    assert.deepEqual(JSON.parse(block), { status: 'sent' });
    assert.match(sent[0], /Opening the PR/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ask stays offline until WhatsApp is linked', async () => {
  const relay = createRelay({
    async send() {
      throw new Error('should not send');
    },
  });
  const app = createApp({ token: 'secret', relay, status: () => 'qr' });
  const { server, base } = await listen(app);
  try {
    await rpc(base, 'secret', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });
    const call = await rpc(base, 'secret', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'whatsapp_ask', arguments: { question: 'Ship it?' } },
    });
    assert.equal(call.payload.result.isError, true);
    assert.match(call.payload.result.content[0].text, /QR scan/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
