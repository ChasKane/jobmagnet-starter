import pino from 'pino';
import qrcode from 'qrcode-terminal';
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { digitsFromJid, incomingFields, phoneJid, samePhone } from './format.js';

const logger = pino({ level: 'error' });

export function createWhatsApp({ authDir, to, onReply }) {
  const owner = phoneJid(to).split('@')[0];
  const allowedJids = new Set();
  let generation = 0;
  let reconnectTimer = null;
  let sock = null;
  let state = 'close';
  let sendJid = phoneJid(to);

  function allowed(jid, alt) {
    if (jid && allowedJids.has(jid)) return true;
    if (alt && allowedJids.has(alt)) return true;
    return samePhone(digitsFromJid(jid), owner) || samePhone(digitsFromJid(alt), owner);
  }

  function takeMessage(msg) {
    const jid = msg?.key?.remoteJid;
    if (!jid || msg.key.fromMe) return;
    if (jid.endsWith('@g.us') || jid === 'status@broadcast') return;
    const ts = Number(msg.messageTimestamp || 0) * 1000;
    if (ts && Date.now() - ts > 120_000) return;
    if (!allowed(jid, msg.key.remoteJidAlt)) return;
    const fields = incomingFields(msg);
    if (!fields.text && !fields.fallback) return;
    onReply({ text: fields.text, quotedId: fields.quotedId, fallback: fields.fallback });
  }

  async function connect() {
    const gen = ++generation;
    state = 'connecting';
    const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
    const next = makeWASocket({
      auth: {
        creds: auth.creds,
        keys: makeCacheableSignalKeyStore(auth.keys, logger),
      },
      logger,
      markOnlineOnConnect: false,
    });
    sock = next;
    next.ev.on('creds.update', saveCreds);
    next.ev.on('messages.upsert', ({ messages, type }) => {
      if (gen !== generation || type !== 'notify') return;
      for (const msg of messages) takeMessage(msg);
    });
    next.ev.on('connection.update', async (update) => {
      if (gen !== generation) return;
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        state = 'qr';
        console.log('Scan this QR with the spare WhatsApp number (Linked devices):');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        state = 'open';
        try {
          const rows = await next.onWhatsApp(phoneJid(to));
          const row = Array.isArray(rows) ? rows[0] : null;
          if (row?.exists && row.jid) {
            sendJid = row.jid;
            allowedJids.add(row.jid);
          }
        } catch (err) {
          console.error('[agent-whatsapp] could not resolve destination', err?.message || err);
        }
        allowedJids.add(phoneJid(to));
        const me = next.user?.phoneNumber || next.user?.id || '';
        if (samePhone(digitsFromJid(me), owner)) {
          console.error(
            'This linked account is the same number messages are sent to. Your phone will not notify you. Link a spare WhatsApp number instead.'
          );
        }
        console.log('WhatsApp linked. Messages go to a number ending in', owner.slice(-4));
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        state = 'close';
        sock = null;
        if (code === DisconnectReason.loggedOut) {
          console.error('WhatsApp logged this bridge out. Delete agent-whatsapp/auth and start again.');
          return;
        }
        console.error('[agent-whatsapp] connection closed, reconnecting');
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (gen === generation) connect().catch((err) => console.error('[agent-whatsapp]', err?.message || err));
        }, 2000);
      }
    });
  }

  async function send(text) {
    if (state !== 'open' || !sock) throw new Error('WhatsApp is not connected');
    const sent = await sock.sendMessage(sendJid, { text });
    return { id: sent?.key?.id || null };
  }

  return {
    start: connect,
    status: () => state,
    send,
  };
}
