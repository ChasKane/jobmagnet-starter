const MAX_BODY = 3200;

export function clip(value, max = MAX_BODY) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

export function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function samePhone(a, b) {
  const da = digits(a);
  const db = digits(b);
  return da.length >= 8 && da === db;
}

export function digitsFromJid(jid) {
  const raw = String(jid || '');
  if (raw.endsWith('@lid') || raw.endsWith('@g.us') || raw === 'status@broadcast') return '';
  return digits(raw.split('@')[0].split(':')[0]);
}

export function phoneJid(value) {
  const d = digits(value);
  if (d.length < 8) {
    throw new Error('WHATSAPP_TO needs a full number with country code');
  }
  return `${d}@s.whatsapp.net`;
}

function who(agent) {
  const label = clip(agent, 80);
  return label ? `Cloud agent · ${label}` : 'Cloud agent';
}

export function statusText({ agent, message }) {
  return `${who(agent)}\n${clip(message)}`;
}

export function questionText({ id, agent, question }) {
  return `${who(agent)}\n${id} — reply to this message\n\n${clip(question)}`;
}

function unwrap(message) {
  if (!message) return null;
  if (message.ephemeralMessage) return unwrap(message.ephemeralMessage.message);
  if (message.viewOnceMessage) return unwrap(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2) return unwrap(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage) return unwrap(message.documentWithCaptionMessage.message);
  return message;
}

function textOf(message) {
  if (!message) return '';
  if (typeof message.conversation === 'string') return message.conversation;
  if (typeof message.extendedTextMessage?.text === 'string') return message.extendedTextMessage.text;
  if (typeof message.imageMessage?.caption === 'string') return message.imageMessage.caption;
  if (typeof message.videoMessage?.caption === 'string') return message.videoMessage.caption;
  return '';
}

function quotedIdOf(message) {
  return (
    message?.extendedTextMessage?.contextInfo?.stanzaId ||
    message?.imageMessage?.contextInfo?.stanzaId ||
    message?.videoMessage?.contextInfo?.stanzaId ||
    null
  );
}

export function incomingFields(msg) {
  const message = unwrap(msg?.message);
  const text = textOf(message).trim();
  const quotedId = quotedIdOf(message);
  const nonText = !text && !!message && !message.protocolMessage && !message.senderKeyDistributionMessage;
  return {
    text,
    quotedId,
    fallback: nonText ? 'The user sent a WhatsApp message without text. Ask them to reply in words.' : '',
  };
}
