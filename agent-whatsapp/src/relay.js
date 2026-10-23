import { questionText, statusText } from './format.js';

const DEFAULT_WAIT_MS = 180_000;
const MAX_WAIT_MS = 240_000;

function clampWait(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WAIT_MS;
  return Math.min(Math.max(Math.round(n), 1000), MAX_WAIT_MS);
}

function answered(q) {
  return { status: 'answered', questionId: q.id, reply: q.reply };
}

export function createRelay({ send, defaultWaitMs = DEFAULT_WAIT_MS } = {}) {
  if (typeof send !== 'function') throw new Error('relay requires send');
  let seq = 0;
  const questions = new Map();
  const unmatched = [];

  function deliver(q, text) {
    if (q.reply) return q;
    q.reply = text;
    for (const fn of q.listeners) fn();
    q.listeners.clear();
    return q;
  }

  function match(reply) {
    const text = String(reply?.text || '').trim();
    const fallback = String(reply?.fallback || '').trim();
    const body = text || fallback;
    if (!body) return null;
    if (reply.quotedId) {
      for (const q of questions.values()) {
        if (!q.reply && q.stanzaId && q.stanzaId === reply.quotedId) return deliver(q, text || fallback);
      }
      return null;
    }
    const tagged = text.match(/^(q\d+)\b[:\-\s]*(.*)$/is);
    if (tagged) {
      const q = questions.get(tagged[1]);
      if (q && !q.reply) return deliver(q, tagged[2].trim() || text);
      return null;
    }
    const open = [...questions.values()].filter((q) => !q.reply);
    if (open.length === 1) return deliver(open[0], body);
    return null;
  }

  function flush() {
    const still = [];
    for (const reply of unmatched) {
      if (!match(reply)) still.push(reply);
    }
    unmatched.length = 0;
    unmatched.push(...still);
  }

  function pushReply(reply) {
    const hit = match(reply);
    if (hit) return hit;
    unmatched.push(reply);
    return null;
  }

  function findOpen(agent, question) {
    const key = `${agent || ''}\n${question.trim()}`;
    for (const q of questions.values()) {
      if (!q.reply && q.key === key) return q;
    }
    return null;
  }

  function add(agent, question) {
    const id = `q${++seq}`;
    const q = {
      id,
      key: `${agent || ''}\n${question.trim()}`,
      agent: agent || '',
      question: question.trim(),
      stanzaId: null,
      reply: null,
      listeners: new Set(),
    };
    questions.set(id, q);
    return q;
  }

  function waitFor(q, ms, signal) {
    if (q.reply) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        q.listeners.delete(onReply);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
      function onReply() {
        done();
      }
      function onAbort() {
        done();
      }
      q.listeners.add(onReply);
      if (signal?.aborted) {
        done();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function ask({ agent, question, waitMs, signal }) {
    const text = String(question || '').trim();
    if (!text) return { status: 'error', error: 'question is empty' };
    const existing = findOpen(agent, text);
    const q = existing || add(agent, text);
    if (!existing) {
      const sent = await send(questionText({ id: q.id, agent, question: text }));
      q.stanzaId = sent && sent.id ? sent.id : null;
      flush();
    }
    if (q.reply) return answered(q);
    const ms = clampWait(waitMs ?? defaultWaitMs);
    await waitFor(q, ms, signal);
    if (q.reply) return answered(q);
    return {
      status: 'pending',
      questionId: q.id,
      waitedSeconds: Math.round(ms / 1000),
      instruction:
        'The user has not replied yet. Call whatsapp_wait with this questionId. Do not continue as if they answered.',
    };
  }

  async function wait(questionId, waitMs, signal) {
    const q = questions.get(questionId);
    if (!q) return { status: 'unknown', questionId, error: 'No question with that id is open.' };
    if (q.reply) return answered(q);
    const ms = clampWait(waitMs ?? defaultWaitMs);
    await waitFor(q, ms, signal);
    if (q.reply) return answered(q);
    return {
      status: 'pending',
      questionId: q.id,
      waitedSeconds: Math.round(ms / 1000),
      instruction:
        'The user has not replied yet. Call whatsapp_wait with this questionId. Do not continue as if they answered.',
    };
  }

  async function statusMessage({ agent, message }) {
    const text = String(message || '').trim();
    if (!text) return { status: 'error', error: 'message is empty' };
    await send(statusText({ agent, message: text }));
    return { status: 'sent' };
  }

  return { ask, wait, statusMessage, pushReply };
}
