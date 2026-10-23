import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay.js';
import { createApp } from './server.js';
import { createWhatsApp } from './whatsapp.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
  }
}

loadEnv(path.join(root, '.env'));

const token = process.env.BRIDGE_TOKEN || '';
const to = process.env.WHATSAPP_TO || '';
const port = Number(process.env.PORT || 3872);
const waitMs = Number(process.env.ASK_WAIT_SECONDS || 180) * 1000;

if (!token || token.length < 16) {
  console.error('Set BRIDGE_TOKEN in agent-whatsapp/.env to a random string of at least 16 characters.');
  process.exit(1);
}
if (!to) {
  console.error('Set WHATSAPP_TO in agent-whatsapp/.env to your personal number, country code included.');
  process.exit(1);
}

let relay;
const wa = createWhatsApp({
  authDir: path.join(root, 'auth'),
  to,
  onReply: (reply) => relay.pushReply(reply),
});
relay = createRelay({
  send: (text) => wa.send(text),
  defaultWaitMs: waitMs,
});

const app = createApp({ token, relay, status: () => wa.status() });
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`WhatsApp bridge listening on http://127.0.0.1:${port}/mcp`);
  console.log('Cloud agents need an https URL. In another terminal: cloudflared tunnel --url http://127.0.0.1:' + port);
});

wa.start().catch((err) => {
  console.error('[agent-whatsapp]', err?.message || err);
  process.exit(1);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
