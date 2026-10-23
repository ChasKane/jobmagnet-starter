import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

const INSTRUCTIONS = `You can reach the user on WhatsApp while this run is still going.

whatsapp_status — send a short progress note. Use it when a meaningful step finishes, a blocker appears, or a long stretch is starting. Do not send one for every tool call. It does not wait for a reply.

whatsapp_ask — ask one question only the user can answer, then wait. Use it before guessing on a destructive change, a missing credential, or a product decision. When it returns status "answered", follow their reply. When it returns status "pending", call whatsapp_wait with the same questionId until they answer. Do not continue as if they answered.

Do not put secrets, tokens, or passwords in either tool. Keep each message to a few sentences. Put the repo or task name in the agent field.`;

function tokenOk(expected, header) {
  const got = String(header || '').startsWith('Bearer ') ? String(header).slice(7) : '';
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function offlineMessage(state) {
  if (state === 'qr') return 'WhatsApp is waiting for a QR scan in the agent-whatsapp terminal.';
  if (state === 'connecting') return 'WhatsApp is still connecting. Try again in a few seconds.';
  return 'WhatsApp is offline. Restart the agent-whatsapp bridge and scan the QR code if it asks.';
}

function toolResult(payload, isError = false) {
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function buildServer(relay, status) {
  const server = new McpServer({ name: 'agent-whatsapp', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  async function ready() {
    const state = status();
    if (state === 'open') return null;
    return toolResult({ status: 'offline', error: offlineMessage(state) }, true);
  }

  server.registerTool(
    'whatsapp_status',
    {
      description:
        'Send the user a short WhatsApp status update while this run is still going. Does not wait for a reply. Use for a real step change, blocker, or long task. Skip it for routine tool calls. Never include secrets.',
      inputSchema: z.object({
        message: z.string().describe('One or two sentences the user should read on their phone.'),
        agent: z.string().optional().describe('Repo or task name, shown at the top of the message.'),
      }),
    },
    async ({ message, agent }) => {
      const blocked = await ready();
      if (blocked) return blocked;
      try {
        return toolResult(await relay.statusMessage({ agent, message }));
      } catch (err) {
        return toolResult({ status: 'error', error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    'whatsapp_ask',
    {
      description:
        'Text the user one question on WhatsApp and wait for their reply before continuing. Use only when they must decide. If the result status is pending, call whatsapp_wait with questionId. If status is answered, follow reply. Never include secrets.',
      inputSchema: z.object({
        question: z.string().describe('The question, in a few sentences, with the options if there are any.'),
        agent: z.string().optional().describe('Repo or task name, shown at the top of the message.'),
        waitSeconds: z
          .number()
          .int()
          .min(1)
          .max(240)
          .optional()
          .describe('How long to wait for a reply. Defaults to the bridge setting, capped at 240.'),
      }),
    },
    async ({ question, agent, waitSeconds }, extra) => {
      const blocked = await ready();
      if (blocked) return blocked;
      try {
        const out = await relay.ask({
          agent,
          question,
          waitMs: waitSeconds ? waitSeconds * 1000 : undefined,
          signal: extra?.signal,
        });
        return toolResult(out, out.status === 'error');
      } catch (err) {
        return toolResult({ status: 'error', error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    'whatsapp_wait',
    {
      description:
        'Keep waiting for a reply to a WhatsApp question already sent. Pass the questionId from whatsapp_ask. If status is still pending, call this again. If status is answered, follow reply.',
      inputSchema: z.object({
        questionId: z.string().describe('Id returned by whatsapp_ask, such as q1.'),
        waitSeconds: z.number().int().min(1).max(240).optional().describe('How long to wait this call.'),
      }),
    },
    async ({ questionId, waitSeconds }, extra) => {
      const blocked = await ready();
      if (blocked) return blocked;
      try {
        const out = await relay.wait(questionId, waitSeconds ? waitSeconds * 1000 : undefined, extra?.signal);
        return toolResult(out, out.status === 'unknown');
      } catch (err) {
        return toolResult({ status: 'error', error: String(err?.message || err) }, true);
      }
    }
  );

  return server;
}

export function createApp({ token, relay, status }) {
  if (!token) throw new Error('BRIDGE_TOKEN is required');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ whatsapp: status() });
  });

  app.use('/mcp', (req, res, next) => {
    if (!tokenOk(token, req.headers.authorization)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  app.post('/mcp', async (req, res) => {
    const server = buildServer(relay, status);
    try {
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      console.error('[agent-whatsapp] mcp', err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });

  return app;
}
