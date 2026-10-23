const fs = require('fs');
const path = require('path');

const { UI_MAX } = require('./context-budget');
const CHAT_FILE = path.join(__dirname, '..', 'knowledge', 'archive', 'chats.json');
const MAX_MESSAGES = UI_MAX;

let cached = null;
let cachedPath = '';

function chatFile() {
  if (process.env.MAGNET_KNOWLEDGE) return path.join(process.env.MAGNET_KNOWLEDGE, 'archive', 'chats.json');
  return CHAT_FILE;
}

function persistApi() {
  const persist = require('../packages/persist');
  persist.open();
  return persist.nodeStore();
}

function invalidate() {
  cached = null;
  cachedPath = '';
}

function loadDoc() {
  const file = chatFile();
  if (cached && cachedPath === file) return cached;
  try {
    if (!fs.existsSync(file)) {
      cached = { by_url: {} };
      cachedPath = file;
      return cached;
    }
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!doc || typeof doc !== 'object' || !doc.by_url || typeof doc.by_url !== 'object') {
      cached = { by_url: {} };
      cachedPath = file;
      return cached;
    }
    cached = doc;
    cachedPath = file;
    return cached;
  } catch (_) {
    cached = { by_url: {} };
    cachedPath = file;
    return cached;
  }
}

function slimTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((t) => t && t.name)
    .map((t) => ({
      name: String(t.name),
      args: t.args && typeof t.args === 'object' ? t.args : {},
      result: String(t.result || '').slice(0, 1600),
    }));
}

function slimAsks(asks) {
  return (Array.isArray(asks) ? asks : [])
    .filter((a) => a && (a.prompt || a.question))
    .map((a) => ({
      id: String(a.id || ''),
      prompt: String(a.prompt || a.question || ''),
      options: Array.isArray(a.options)
        ? a.options
            .filter((o) => o && (o.label || o.text))
            .map((o) => ({ id: String(o.id || ''), label: String(o.label || o.text || '') }))
        : [],
      allow_multiple: Boolean(a.allow_multiple),
      answered: Boolean(a.answered),
    }));
}

function slimFolds(folds) {
  return (Array.isArray(folds) ? folds : [])
    .filter((f) => f && String(f.text || '').trim())
    .map((f) => ({
      level: f.level === 'error' ? 'error' : f.level === 'warn' ? 'warn' : String(f.level || ''),
      label: String(f.label || (f.level === 'error' ? 'error' : '')),
      text: String(f.text),
    }));
}

function slimMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const role = m.role === 'you' ? 'you' : 'magnet';
  const drafts = Array.isArray(m.drafts)
    ? m.drafts
        .filter((d) => d && String(d.text || '').trim())
        .map((d) => ({
          id: d.id || '',
          label: d.label || d.id || '',
          text: String(d.text),
        }))
    : [];
  const text = String(m.text || '');
  const tools = slimTools(m.tools);
  const asks = slimAsks(m.asks);
  const folds = slimFolds(m.folds);
  if (m.kind === 'mail') {
    return {
      role: 'magnet',
      kind: 'mail',
      text,
      mailId: m.mailId || '',
      href: m.href || '',
      reason: m.reason || '',
      candidates: Array.isArray(m.candidates) ? m.candidates : [],
      read: Boolean(m.read),
      at: Number(m.at) || Date.now(),
    };
  }
  if (!text.trim() && !drafts.length && !tools.length && !asks.length && !folds.length) return null;
  return {
    role,
    text,
    drafts,
    tools,
    asks,
    ...(folds.length ? { folds } : {}),
    at: Number(m.at) || Date.now(),
    fieldIds: Array.isArray(m.fieldIds) ? m.fieldIds : [],
  };
}

function slimChat(messages) {
  const list = (Array.isArray(messages) ? messages : []).map(slimMessage).filter(Boolean);
  return list.length > MAX_MESSAGES ? list.slice(-MAX_MESSAGES) : list;
}

function loadChatState(url) {
  const key = String(url || '');
  if (!key) return { messages: [], folded: [], agentId: '', snapshotKey: '', pageSubtab: 'chat' };
  const row = persistApi().getChatState(key);
  return {
    messages: slimChat(row.messages),
    folded: slimChat(row.folded),
    agentId: String(row.agentId || ''),
    snapshotKey: String(row.snapshotKey || ''),
    pageSubtab: row.pageSubtab || 'chat',
    company: row.company || '',
    title: row.title || '',
  };
}

function loadChat(url) {
  return loadChatState(url).messages;
}

function saveChat(url, messages, meta = {}) {
  const key = String(url || '');
  if (!key) return;
  persistApi().saveChat(key, slimChat(messages), {
    ...(meta.company ? { company: meta.company } : {}),
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.folded != null ? { folded: slimChat(meta.folded) } : {}),
    ...(meta.agentId != null ? { agentId: String(meta.agentId) } : {}),
    ...(meta.snapshotKey != null ? { snapshotKey: String(meta.snapshotKey) } : {}),
    ...(meta.pageSubtab != null ? { pageSubtab: meta.pageSubtab } : {}),
  });
}

function loadChatUi() {
  return persistApi().getChatUi();
}

function saveChatUi(ui) {
  return persistApi().saveChatUi(ui);
}

function listChats() {
  return persistApi().listChats().map((row) => ({
    url: row.url || row.key,
    company: row.company || '',
    title: row.title || '',
    messages: slimChat(row.messages),
  }));
}

module.exports = {
  CHAT_FILE,
  MAX_MESSAGES,
  loadChat,
  loadChatState,
  saveChat,
  slimChat,
  listChats,
  loadDoc,
  loadChatUi,
  saveChatUi,
  invalidate,
};
