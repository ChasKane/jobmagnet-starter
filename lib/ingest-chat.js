const { runIntent, heuristicIntent } = require('./intent-parse');
const { normalizeAsks } = require('./chat-tools');

function mailShortcut(message) {
  const guessed = heuristicIntent(message);
  if (guessed.action === 'connect_mail') {
    return {
      ok: true,
      reply: 'Opening Google sign-in…',
      tools: [],
      asks: [],
      needConnect: true,
    };
  }
  if (guessed.action === 'scan_mail') {
    return {
      ok: true,
      reply: 'Scanning inbox…',
      tools: [],
      asks: [],
      needScan: true,
    };
  }
  return null;
}

function ingestCancelledError() {
  const err = new Error('fill cancelled');
  err.cancelled = true;
  return err;
}

async function spawnIngestSdk(payload, opts = {}) {
  const ev = await require('./agent-client').invoke('ingest', payload, {
    timeout: 120000,
    key: require('./chat-tabs').INGEST_KEY,
    signal: opts.signal,
  });
  if (ev && ev.cancelled) throw ingestCancelledError();
  return ev.result || ev;
}

async function runIngestChat(message, history = [], opts = {}) {
  const text = String(message || '').trim();
  if (!text) return { ok: false, reply: 'Empty.', tools: [], asks: [] };

  const mail = mailShortcut(text);
  if (mail) return mail;

  if (process.env.CURSOR_API_KEY) {
    try {
      const out = await spawnIngestSdk({ message: text, history }, opts);
      if (out && out.ok) {
        const actions = out.actions || {};
        return {
          ok: true,
          reply: out.reply || 'Okay.',
          tools: Array.isArray(out.tools) ? out.tools : [],
          asks: normalizeAsks(out.asks),
          needConnect: Boolean(actions.needConnect),
          needScan: Boolean(actions.needScan),
          urls: (actions.add_urls && actions.add_urls.urls) || (actions.find_jobs && actions.find_jobs.urls) || [],
          added: (actions.add_urls && actions.add_urls.added) || 0,
          jds: (actions.add_urls && actions.add_urls.jds) || 0,
          needApproval: Boolean(actions.search_plan),
          plan: actions.search_plan || null,
          schema: actions.search_plan || null,
          sent: { prompt: out.prompt },
          received: { raw: out.raw, actions },
        };
      }
    } catch (err) {
      if (err && err.cancelled) throw err;
      console.warn('[magnet] ingest sdk, intent fallback:', err.message || err);
    }
  }

  const intent = await runIntent(text);
  return {
    ok: Boolean(intent && intent.ok),
    reply: (intent && intent.reply) || 'Could not parse that.',
    tools: [],
    asks: [],
    needConnect: Boolean(intent && intent.needConnect),
    needScan: Boolean(intent && intent.needScan),
    urls: (intent && intent.urls) || [],
    added: (intent && intent.added) || 0,
    jds: (intent && intent.jds) || 0,
    needApproval: Boolean(intent && intent.needApproval),
    plan: (intent && (intent.plan || intent.schema)) || null,
    schema: (intent && (intent.schema || intent.plan)) || null,
    intent,
  };
}

module.exports = { runIngestChat, mailShortcut };
