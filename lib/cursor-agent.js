const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const models = require('./models');
const { extractText } = require('./extract-text');

const LLM_LOG = path.join(__dirname, '..', 'knowledge', 'archive', 'llm.jsonl');

function scratchDir() {
  const dir = path.join(__dirname, '..', '.scratch');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Local agent. Isolated cwd so we don't index the whole workspace. */
function promptOpts(extra = {}) {
  const local = {
    cwd: scratchDir(),
    settingSources: [],
    ...(extra.customTools ? { customTools: extra.customTools } : {}),
  };
  return {
    apiKey: process.env.CURSOR_API_KEY,
    model: extra.model || models.toAgentModel(models.selectionFrom(settings.load())),
    name: extra.name || 'jobmagnet-draft',
    tools: extra.tools != null ? extra.tools : [],
    local,
  };
}

function jsonSafe(value) {
  const seen = new WeakSet();
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === 'bigint') return String(v);
        if (typeof v === 'function') return undefined;
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      })
    );
  } catch {
    return String(value);
  }
}

function jsonLogOutput(output) {
  if (output == null) return null;
  if (typeof output === 'string') {
    try {
      JSON.parse(output);
      return output;
    } catch {
      return JSON.stringify(output);
    }
  }
  if (typeof output === 'object') return JSON.stringify(output);
  return output;
}

function testing() {
  const args = [...process.execArgv, ...process.argv];
  return args.some((arg) => arg === '--test' || String(arg).endsWith('.test.js'));
}

function appendLlmLog(row) {
  let remote = false;
  if (!testing()) {
    try {
      const output = row.output == null ? null : row.output;
      remote = require('./store/remote-log').insert('llm_log', {
        ts: row.ts,
        caller: row.caller || null,
        model: row.model || null,
        model_params: jsonLogOutput(row.model_params || null),
        request_id: row.request_id || null,
        input: row.input == null ? null : String(row.input),
        output: jsonLogOutput(output),
        error: row.error || null,
        duration_ms: row.duration_ms,
      });
    } catch (err) {
      console.warn('[magnet] llm log:', (err && err.message) || err);
    }
  }
  if (remote) return;
  try {
    fs.mkdirSync(path.dirname(LLM_LOG), { recursive: true });
    fs.appendFileSync(LLM_LOG, JSON.stringify(row) + '\n');
  } catch (_) {}
}

async function disposeAgent(agent) {
  if (!agent) return;
  try {
    if (typeof agent[Symbol.asyncDispose] === 'function') await agent[Symbol.asyncDispose]();
    else if (typeof agent.dispose === 'function') await agent.dispose();
  } catch (_) {}
}

async function promptWithSignal(Agent, prompt, extra) {
  const signal = extra && extra.signal;
  if (signal && signal.aborted) throw cancelledError();
  const agent = await createAgent(Agent, extra);
  try {
    if (signal && signal.aborted) throw cancelledError();
    try {
      const out = await streamSend(agent, prompt, { model: extra.model, tools: extra.tools, signal, skipLog: true });
      return out.result;
    } catch (err) {
      if (err && err.cancelled) throw err;
      const msg = String((err && err.message) || err);
      if (/tools|ConfigurationError/i.test(msg)) {
        const out = await streamSend(agent, prompt, { model: extra.model, tools: [], signal, skipLog: true });
        return out.result;
      }
      throw err;
    }
  } finally {
    await disposeAgent(agent);
  }
}

async function promptText(Agent, prompt, extra) {
  const opts = promptOpts(extra || {});
  const started = Date.now();
  const row = {
    ts: new Date().toISOString(),
    caller: path.basename(process.argv[1] || ''),
    model: opts.model && opts.model.id,
    model_params: opts.model && opts.model.params,
    input: prompt,
    request_id: extra && extra.request_id,
  };
  try {
    let result;
    if (extra && extra.signal) {
      result = await promptWithSignal(Agent, prompt, extra);
    } else {
      try {
        result = await Agent.prompt(prompt, opts);
      } catch (err) {
        const msg = String((err && err.message) || err);
        if (/tools|ConfigurationError/i.test(msg)) {
          result = await Agent.prompt(prompt, { ...opts, tools: [] });
        } else {
          throw err;
        }
      }
    }
    row.duration_ms = Date.now() - started;
    row.output = jsonSafe(result);
    appendLlmLog(row);
    return result;
  } catch (err) {
    row.duration_ms = Date.now() - started;
    row.error = String((err && err.stack) || (err && err.message) || err);
    appendLlmLog(row);
    throw err;
  }
}

function agentIdOf(agent) {
  return (agent && (agent.agentId || agent.id || (agent.agent && agent.agent.id))) || '';
}

async function createAgent(Agent, extra = {}) {
  return Agent.create(promptOpts(extra));
}

async function resumeAgent(Agent, agentId, extra = {}) {
  return Agent.resume(agentId, promptOpts(extra));
}

function cancelledError() {
  const err = new Error('fill cancelled');
  err.cancelled = true;
  return err;
}

function isActiveRunError(err) {
  return /already has active run/i.test(String((err && err.message) || err || ''));
}

async function cancelAgentRun(agent, run) {
  try {
    if (run && typeof run.cancel === 'function') await run.cancel();
    else if (agent && typeof agent.cancel === 'function') await agent.cancel();
  } catch (_) {}
}

async function streamSendOnce(agent, text, extra = {}, onEvent) {
  const signal = extra.signal;
  if (signal && signal.aborted) throw cancelledError();
  const opts = {};
  if (extra.model) opts.model = extra.model;
  if (extra.tools != null) opts.tools = extra.tools;
  let run = null;
  const abort = async () => {
    await cancelAgentRun(agent, run);
  };
  if (signal) signal.addEventListener('abort', abort, { once: true });
  try {
    run = await agent.send(text, Object.keys(opts).length ? opts : undefined);
    if (signal && signal.aborted) {
      await abort();
      throw cancelledError();
    }
    let full = '';
    if (run && typeof run.stream === 'function') {
      for await (const event of run.stream()) {
        if (signal && signal.aborted) throw cancelledError();
        if (event && event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
          for (const block of event.message.content) {
            if (block && block.type === 'text' && block.text) {
              full += block.text;
              if (onEvent) onEvent({ type: 'delta', text: block.text });
            }
          }
        } else if (event && (event.type === 'tool' || event.type === 'tool_call')) {
          if (onEvent) {
            onEvent({
              type: 'tool',
              name: event.name || (event.tool && event.tool.name) || '',
              args: event.args || (event.tool && event.tool.args) || {},
            });
          }
        }
      }
    }
    if (signal && signal.aborted) throw cancelledError();
    const result = run && typeof run.wait === 'function' ? await run.wait() : run;
    return { result, text: extractText(result) || full, agentId: agentIdOf(agent) };
  } finally {
    if (signal) signal.removeEventListener('abort', abort);
  }
}

function logStream(text, extra, started, out, error) {
  if (extra && extra.skipLog) return;
  if (testing()) return;
  const model = extra && extra.model;
  appendLlmLog({
    ts: new Date().toISOString(),
    caller: (extra && extra.caller) || 'chat',
    model: model && (model.id || model),
    model_params: model && model.params,
    request_id: extra && extra.request_id,
    input: text,
    output: out ? { text: out.text, result: jsonSafe(out.result) } : undefined,
    error,
    duration_ms: Date.now() - started,
  });
}

async function streamSend(agent, text, extra = {}, onEvent) {
  const started = Date.now();
  try {
    const out = await streamSendOnce(agent, text, extra, onEvent);
    logStream(text, extra, started, out);
    return out;
  } catch (err) {
    if ((extra && extra.signal && extra.signal.aborted) || (err && err.cancelled) || !isActiveRunError(err)) {
      if (!(err && err.cancelled)) logStream(text, extra, started, null, String((err && err.stack) || (err && err.message) || err));
      throw err;
    }
    await cancelAgentRun(agent, null);
    const out = await streamSendOnce(agent, text, extra, onEvent);
    logStream(text, extra, started, out);
    return out;
  }
}

module.exports = {
  promptOpts,
  promptText,
  scratchDir,
  LLM_LOG,
  extractText,
  createAgent,
  resumeAgent,
  streamSend,
  agentIdOf,
  isActiveRunError,
  cancelAgentRun,
};
