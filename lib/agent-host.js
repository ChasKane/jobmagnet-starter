#!/usr/bin/env node
/**
 * Long-lived Node host. JSONL on stdin/stdout. Only process that requires @cursor/sdk.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function loadDotEnv() {
  const p = path.join(__dirname, '..', '.env');
  try {
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) {}
}

function parseLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function loadToolSet(name, state) {
  if (name === 'ingest') {
    const { ingestTools } = require('./ingest-sdk');
    return ingestTools(state || { traces: [], asks: [], actions: {} });
  }
  if (name === 'chat') {
    const { sharedCustomTools } = require('./chat-tools');
    return sharedCustomTools(state || { traces: [], asks: [] });
  }
  return undefined;
}

function createHostRuntime(deps = {}) {
  const sessions = new Map();
  const inflight = new Map();
  const tails = new Map();
  const emit = deps.emit || (() => {});
  const getAgent = () => {
    if (deps.Agent) return deps.Agent;
    ({ Agent: deps.Agent } = require('@cursor/sdk'));
    return deps.Agent;
  };
  const cursor = () => {
    if (deps.cursor) return deps.cursor;
    deps.cursor = require('./cursor-agent');
    return deps.cursor;
  };
  const extract = deps.extractText || ((r) => cursor().extractText(r));

  function hostCancelledError() {
    const err = new Error('fill cancelled');
    err.cancelled = true;
    return err;
  }

  function throwIfHostAborted(signal) {
    if (signal && signal.aborted) throw hostCancelledError();
  }

  function beginInflight(id, key) {
    const ac = new AbortController();
    inflight.set(id, { key, abort: ac });
    return ac;
  }

  async function disposeKey(key) {
    const sess = sessions.get(key);
    sessions.delete(key);
    if (!sess || !sess.agent) return;
    try {
      if (typeof sess.agent.cancel === 'function') await sess.agent.cancel();
    } catch (_) {}
    try {
      if (typeof sess.agent[Symbol.asyncDispose] === 'function') await sess.agent[Symbol.asyncDispose]();
      else if (typeof sess.agent.dispose === 'function') await sess.agent.dispose();
    } catch (_) {}
  }

  function enqueue(key, fn) {
    const k = String(key || '__none__');
    const prev = tails.get(k) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    tails.set(k, run.catch(() => {}));
    return run;
  }

  async function sendOnSess(key, msg, text, extra, onEvent) {
    return enqueue(key, async () => {
      let sess = sessions.get(key) || (await getOrCreate(key, msg || {}));
      const { streamSend, isActiveRunError } = cursor();
      try {
        return await streamSend(sess.agent, text, extra, onEvent);
      } catch (err) {
        const active =
          (typeof isActiveRunError === 'function' && isActiveRunError(err)) ||
          /already has active run/i.test(String((err && err.message) || err || ''));
        if ((extra && extra.signal && extra.signal.aborted) || !active) throw err;
        await disposeKey(key);
        sess = await getOrCreate(key, { ...(msg || {}), forceCreate: true, agentId: null });
        return streamSend(sess.agent, text, extra, onEvent);
      }
    });
  }

  async function getOrCreate(key, msg) {
    if (msg.forceCreate) await disposeKey(key);
    let sess = sessions.get(key);
    if (sess && sess.agent) return sess;
    const Agent = getAgent();
    const { createAgent, resumeAgent, agentIdOf } = cursor();
    const extra = {
      name: msg.name || 'jobmagnet-chat',
      tools: msg.tools,
      model: msg.model,
    };
    if (msg.toolSet) extra.customTools = loadToolSet(msg.toolSet, msg.toolState);
    if (msg.agentId && !msg.forceCreate) {
      try {
        const agent = await resumeAgent(Agent, msg.agentId, extra);
        sess = { agent, agentId: msg.agentId || agentIdOf(agent) };
      } catch (err) {
        if (!/not found/i.test(String((err && err.message) || err))) throw err;
        const agent = await createAgent(Agent, extra);
        sess = { agent, agentId: agentIdOf(agent) };
      }
    } else {
      const agent = await createAgent(Agent, extra);
      sess = { agent, agentId: agentIdOf(agent) };
    }
    sessions.set(key, sess);
    return sess;
  }

  async function handlePrompt(msg) {
    const Agent = getAgent();
    const { promptText } = cursor();
    const extra = { name: msg.name || 'jobmagnet-prompt', tools: msg.tools != null ? msg.tools : [], model: msg.model };
    if (msg.toolSet) extra.customTools = loadToolSet(msg.toolSet, msg.toolState);
    const result = await promptText(Agent, msg.prompt, extra);
    return { text: extract(result), raw: result };
  }

  async function handleSend(msg, onEvent) {
    const ac = beginInflight(msg.id, msg.key);
    try {
      throwIfHostAborted(ac.signal);
      const { agentIdOf } = cursor();
      const sess = await getOrCreate(msg.key, msg);
      throwIfHostAborted(ac.signal);
      if (msg.snapshot && (msg.forceCreate || !msg.agentId)) {
        await sendOnSess(msg.key, msg, msg.snapshot, { model: msg.model, signal: ac.signal });
        throwIfHostAborted(ac.signal);
      }
      if (msg.seed) {
        await sendOnSess(msg.key, msg, msg.seed, { model: msg.model, signal: ac.signal });
        throwIfHostAborted(ac.signal);
      }
      const out = await sendOnSess(
        msg.key,
        msg,
        msg.text,
        { model: msg.model, tools: msg.tools, signal: ac.signal },
        (ev) => {
          if (onEvent) onEvent(ev);
        }
      );
      throwIfHostAborted(ac.signal);
      const live = sessions.get(msg.key) || sess;
      live.agentId = out.agentId || agentIdOf(live.agent) || live.agentId;
      return { text: out.text, agentId: live.agentId, raw: out.result };
    } finally {
      inflight.delete(msg.id);
    }
  }

  async function handleCreate(msg) {
    const ac = beginInflight(msg.id, msg.key);
    try {
      throwIfHostAborted(ac.signal);
      const had = sessions.has(msg.key) && !msg.forceCreate;
      const sess = await getOrCreate(msg.key, msg);
      throwIfHostAborted(ac.signal);
      if (!had && !msg.agentId) {
        if (msg.snapshot) await sendOnSess(msg.key, msg, msg.snapshot, { model: msg.model, signal: ac.signal });
        throwIfHostAborted(ac.signal);
        if (msg.seed) await sendOnSess(msg.key, msg, msg.seed, { model: msg.model, signal: ac.signal });
        throwIfHostAborted(ac.signal);
      }
      const live = sessions.get(msg.key) || sess;
      return { agentId: live.agentId };
    } finally {
      inflight.delete(msg.id);
    }
  }

  function handleCancel(msg) {
    const ids = [];
    if (msg.targetId != null && inflight.has(msg.targetId)) ids.push(msg.targetId);
    if (msg.key) {
      for (const [id, row] of inflight) {
        if (row.key === msg.key && !ids.includes(id)) ids.push(id);
      }
    }
    if (!ids.length && msg.id != null && inflight.has(msg.id)) ids.push(msg.id);
    for (const id of ids) {
      const row = inflight.get(id);
      if (!row) continue;
      try {
        row.abort.abort();
      } catch (_) {}
    }
    return { ok: true };
  }

  async function handleInvoke(msg, onEvent) {
    const Agent = getAgent();
    const { promptText } = cursor();
    const name = String(msg.name || '');
    if (name === 'cascade' || name === 'essay') {
      const { runEssayTurn } = require('./essay-draft');
      const key = msg.key || (msg.payload && msg.payload.tabId);
      const ac = beginInflight(msg.id, key);
      try {
        throwIfHostAborted(ac.signal);
        const sendChat = async (text, opts = {}) => {
          throwIfHostAborted(ac.signal);
          const sess = await getOrCreate(key, {
            ...msg,
            agentId: (msg.payload && msg.payload.agentId) || msg.agentId,
            forceCreate: Boolean(msg.payload && msg.payload.forceCreate),
            snapshot: opts.snapshot || (msg.payload && msg.payload.snapshot),
            seed: msg.payload && msg.payload.seed,
            model: msg.model,
            tools: msg.tools || require('./chat-tools').CHAT_TOOLS.slice(),
            toolSet: msg.toolSet || 'chat',
          });
          throwIfHostAborted(ac.signal);
          const extra = opts.extra || {};
          const out = await sendOnSess(
            key,
            {
              ...msg,
              agentId: (msg.payload && msg.payload.agentId) || msg.agentId,
              forceCreate: Boolean(msg.payload && msg.payload.forceCreate),
              model: msg.model,
              tools: extra.tools || msg.tools || require('./chat-tools').CHAT_TOOLS.slice(),
              toolSet: msg.toolSet || 'chat',
            },
            text,
            {
              model: msg.model,
              tools: extra.tools || msg.tools || require('./chat-tools').CHAT_TOOLS.slice(),
              signal: ac.signal,
            },
            (ev) => {
              if (opts.stream === false) return;
              if (onEvent) onEvent(ev);
            }
          );
          const live = sessions.get(key) || sess;
          live.agentId = out.agentId || live.agentId;
          return out.text;
        };
        const out = await runEssayTurn(msg.payload || {}, {
          promptText,
          Agent,
          extractText: extract,
          requestId: msg.payload && msg.payload.request_id,
          onProgress: (info) => onEvent && onEvent({ type: 'stage', ...info }),
          onDrafts: (drafts) => onEvent && onEvent({ type: 'drafts', drafts }),
          sendChat,
          signal: ac.signal,
        });
        const sess = sessions.get(key);
        return { ...out, agentId: sess && sess.agentId };
      } finally {
        inflight.delete(msg.id);
      }
    }
    if (name === 'fill-review') {
      const { runFillReview } = require('./fill-review');
      const key = msg.key || (msg.payload && msg.payload.tabId);
      const ac = beginInflight(msg.id, key);
      try {
        throwIfHostAborted(ac.signal);
        const sendChat = async (text) => {
          throwIfHostAborted(ac.signal);
          const sess = await getOrCreate(key, {
            ...msg,
            name: msg.name || 'jobmagnet-fill-review',
            tools: [],
            agentId: (msg.payload && msg.payload.agentId) || msg.agentId,
            forceCreate: Boolean(msg.payload && msg.payload.forceCreate),
            snapshot: msg.payload && msg.payload.snapshot,
            model: msg.model,
          });
          throwIfHostAborted(ac.signal);
          const out = await sendOnSess(
            key,
            {
              ...msg,
              name: msg.name || 'jobmagnet-fill-review',
              tools: [],
              agentId: (msg.payload && msg.payload.agentId) || msg.agentId,
              forceCreate: Boolean(msg.payload && msg.payload.forceCreate),
              model: msg.model,
            },
            text,
            { model: msg.model, tools: [], signal: ac.signal }
          );
          const live = sessions.get(key) || sess;
          live.agentId = out.agentId || live.agentId;
          return out.text;
        };
        return await runFillReview(msg.payload || {}, {
          promptText,
          Agent,
          extractText: extract,
          sendChat,
          signal: ac.signal,
        });
      } finally {
        inflight.delete(msg.id);
      }
    }
    if (name === 'ingest') {
      const { runIngestTurn } = require('./ingest-sdk');
      const key = msg.key || require('./chat-tabs').INGEST_KEY;
      const ac = beginInflight(msg.id, key);
      try {
        throwIfHostAborted(ac.signal);
        return await runIngestTurn(msg.payload || {}, {
          promptText,
          Agent,
          extractText: extract,
          signal: ac.signal,
        });
      } finally {
        inflight.delete(msg.id);
      }
    }
    if (name === 'ingest-hunt') {
      const { runIngestHunt } = require('./hunt-sdk');
      const key = msg.key || require('./chat-tabs').INGEST_KEY;
      const ac = beginInflight(msg.id, key);
      try {
        throwIfHostAborted(ac.signal);
        return await runIngestHunt(msg.payload || {}, {
          promptText,
          Agent,
          extractText: extract,
          signal: ac.signal,
        });
      } finally {
        inflight.delete(msg.id);
      }
    }
    if (name === 'intent') {
      const { parseIntentLlm } = require('./intent-sdk');
      return parseIntentLlm((msg.payload && msg.payload.message) || msg.message, {
        promptText,
        Agent,
        extractText: extract,
      });
    }
    if (name === 'jd-judge') {
      const { runJdJudge } = require('./jd-judge');
      return runJdJudge(msg.payload || {}, { promptText, Agent, extractText: extract });
    }
    if (name === 'classify') {
      const { runClassify } = require('./mail/classify-sdk');
      return runClassify(msg.payload || {}, { promptText, Agent, extractText: extract });
    }
    if (name === 'voice-compact') {
      const { compactFromRows, loadRows } = require('./voice-compact');
      return compactFromRows(loadRows());
    }
    if (name === 'voice-debrief') {
      const { runDebrief } = require('./voice-debrief');
      return runDebrief(msg.payload || {}, { promptText, Agent, extractText: extract });
    }
    if (name === 'compile') {
      const { llmProposeCards } = require('./compile-llm');
      const cards = await llmProposeCards((msg.payload && msg.payload.rows) || [], {
        ...(msg.payload || {}),
        extractText: extract,
      });
      return { cards };
    }
    if (name === 'voice-learn') {
      const { llmProposeVoiceRules } = require('./voice-learn');
      const rules = await llmProposeVoiceRules((msg.payload && msg.payload.pairs) || [], {
        ...(msg.payload || {}),
        extractText: extract,
      });
      return { rules };
    }
    throw new Error(`unknown invoke ${name}`);
  }

  async function dispatch(msg) {
    if (!msg || !msg.op) return { op: 'error', id: msg && msg.id, error: 'bad-op' };
    try {
      if (msg.op === 'ping') return { op: 'pong', id: msg.id };
      if (msg.op === 'prompt') {
        const out = await handlePrompt(msg);
        return { op: 'done', id: msg.id, ...out };
      }
      if (msg.op === 'create') {
        const out = await handleCreate(msg);
        return { op: 'done', id: msg.id, ...out };
      }
      if (msg.op === 'send') {
        const out = await handleSend(msg, (ev) => {
          emit({ op: ev.type, id: msg.id, ...ev });
        });
        return { op: 'done', id: msg.id, ...out };
      }
      if (msg.op === 'cancel') {
        const out = handleCancel(msg);
        return { op: 'done', id: msg.id, ...out };
      }
      if (msg.op === 'dispose') {
        await disposeKey(msg.key);
        return { op: 'done', id: msg.id, ok: true };
      }
      if (msg.op === 'invoke') {
        const out = await handleInvoke(msg, (ev) => {
          emit({ op: ev.type, id: msg.id, ...ev });
        });
        return { op: 'done', id: msg.id, result: out, agentId: out && out.agentId };
      }
      return { op: 'error', id: msg.id, error: `unknown op ${msg.op}` };
    } catch (err) {
      const cancelled = Boolean(err && err.cancelled);
      return {
        op: cancelled ? 'done' : 'error',
        id: msg.id,
        error: String((err && err.message) || err),
        cancelled,
      };
    }
  }

  return { dispatch, sessions, disposeKey, parseLine };
}

async function main() {
  loadDotEnv();
  process.env.MAGNET_AGENT_HOST = '1';
  const emit = (obj) => {
    process.stdout.write(JSON.stringify(obj) + '\n');
  };
  let runtime = createHostRuntime({ emit });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const msg = parseLine(line);
    if (!msg) return;
    if (!runtime) runtime = createHostRuntime({ emit });
    const out = await runtime.dispatch(msg);
    emit(out);
  });
}

module.exports = { createHostRuntime, parseLine, loadToolSet };

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(String((err && err.stack) || err) + '\n');
    process.exit(1);
  });
}
