/** Cursor-driven ingest hunt. Tools RPC to Electron's logged-in webview. Never send cookies. */

const { recordTrace } = require('./chat-tools');
const { extractText: defaultExtract } = require('./extract-text');
const { normalizeSchema } = require('../packages/core/src/search-schema');
const { huntStartUrls, JSON_BOARD_SITES, describeHuntPlan } = require('../packages/core/src/hunt-start');
const { huntJobs } = require('../packages/core/src/boards');
const { huntInstructions, slimSnap } = require('../packages/core/src/llm-hunt');

function controlPort(payload) {
  return Number((payload && payload.controlPort) || process.env.MAGNET_PORT || 3871);
}

async function huntCall(port, op, body = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/hunt/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `hunt ${op} ${res.status}`);
    err.body = json;
    throw err;
  }
  return json;
}

function packSnap(out) {
  return JSON.stringify(
    slimSnap(out || {}, {
      added: out && out.added,
      need: out && out.need,
      skipped: out && out.skipped,
      jobs: loadHuntJobs(),
    })
  );
}

function huntTools({ port, traces, call: callFn }) {
  const call = callFn || ((op, body) => huntCall(port, op, body));
  return {
    open_page: {
      description:
        'Navigate the hidden hunt browser to a URL. Uses the local signed-in session. The applicant does not see this page unless they must sign in.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
      annotations: { title: 'Open page' },
      async execute(args) {
        const out = await call('open', { url: args.url });
        const text = packSnap(out);
        recordTrace(traces, 'open_page', args, text);
        return text;
      },
    },
    snapshot_page: {
      description: 'Read the current Apply page: url, title, visible text, clickable refs. login=true means a sign-in wall.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Snapshot page', readOnlyHint: true },
      async execute() {
        const out = await call('snapshot', {});
        const text = packSnap(out);
        recordTrace(traces, 'snapshot_page', {}, text);
        return text;
      },
    },
    click_page: {
      description: 'Click a ref from the latest snapshot (e0, e1, …).',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
      },
      annotations: { title: 'Click' },
      async execute(args) {
        const out = await call('click', { ref: args.ref });
        const text = packSnap(out);
        recordTrace(traces, 'click_page', args, text);
        return text;
      },
    },
    type_page: {
      description: 'Type into a textbox ref. submit=true to press Enter / submit the form.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          text: { type: 'string' },
          submit: { type: 'boolean' },
        },
        required: ['ref', 'text'],
      },
      annotations: { title: 'Type' },
      async execute(args) {
        const out = await call('type', { ref: args.ref, text: args.text, submit: Boolean(args.submit) });
        const text = packSnap(out);
        recordTrace(traces, 'type_page', args, text);
        return text;
      },
    },
    scroll_page: {
      description: 'Scroll the Apply page to load more results.',
      inputSchema: {
        type: 'object',
        properties: { dir: { type: 'string', description: 'down or up' } },
      },
      annotations: { title: 'Scroll' },
      async execute(args) {
        const out = await call('scroll', { dir: args.dir || 'down' });
        const text = packSnap(out);
        recordTrace(traces, 'scroll_page', args, text);
        return text;
      },
    },
    wait_page: {
      description: 'Wait for a SPA to settle, then snapshot.',
      inputSchema: { type: 'object', properties: { ms: { type: 'number' } } },
      annotations: { title: 'Wait' },
      async execute(args) {
        const out = await call('wait', { ms: args.ms });
        const text = packSnap(out);
        recordTrace(traces, 'wait_page', args, text);
        return text;
      },
    },
    add_listing: {
      description:
        'Add a matching job that is not already stored. url is required. Prefer apply URLs. Do not pass a jd — Magnet captures the full posting from the current page. If the result is needJd, click See more or open the posting homepage, then add again. Never summarize. A dupe result means skip that URL. A companyHeld result means that employer is already listed — skip every other posting from that company.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          company: { type: 'string' },
          posting: { type: 'string' },
          linkedin: { type: 'string' },
          location: { type: 'string', description: 'City, region, or Remote. Required for the daily filter.' },
        },
        required: ['url'],
      },
      annotations: { title: 'Add listing' },
      async execute(args) {
        const out = await call('add', args);
        const text = JSON.stringify(out);
        recordTrace(traces, 'add_listing', args, text);
        return text;
      },
    },
    need_sign_in: {
      description:
        'Pause and ask the applicant to sign in. Magnet shows the login page only for this. Returns after they are in, or skipped=true.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, url: { type: 'string' } },
      },
      annotations: { title: 'Need sign-in' },
      async execute(args) {
        const out = await call('sign-in', args);
        const text = JSON.stringify(out);
        recordTrace(traces, 'need_sign_in', args, text);
        return text;
      },
    },
    hunt_status: {
      description: 'How many new listings have been added vs the plan n.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Hunt status', readOnlyHint: true },
      async execute() {
        const out = await call('status', {});
        const text = JSON.stringify(out);
        recordTrace(traces, 'hunt_status', {}, text);
        return text;
      },
    },
  };
}

function huntPrompt({ plan, starts, status, round, last }) {
  const s = normalizeSchema(plan);
  return `${huntInstructions({ plan: s, starts, status })}

Use tools. Start by opening the first unused start URL if you are not already on a useful page. Paginate. Open JDs. Call add_listing when a posting matches. Call need_sign_in when you hit a login wall (the snapshot will also say login=true). Call hunt_status before you stop.

Round ${round + 1}. Last reply: ${String(last || '').slice(0, 400) || '(start)'}

When you are done, reply in one short sentence: added N of ${s.n}, which sites you covered.`;
}

function huntCancelledError() {
  const err = new Error('fill cancelled');
  err.cancelled = true;
  return err;
}

function loadHuntYaml(name, key) {
  const fs = require('fs');
  const path = require('path');
  const yaml = require('js-yaml');
  try {
    const doc = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'knowledge', name), 'utf8')) || {};
    return Array.isArray(doc[key]) ? doc[key] : [];
  } catch {
    return [];
  }
}

function loadHuntBoards() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().listBoards();
  }
  return loadHuntYaml('boards.yaml', 'boards');
}

function loadHuntJobs() {
  if (require('./store/mode').isSupabase()) return require('./live-jobs').listLiveJobs();
  return loadHuntYaml('jobs.yaml', 'jobs');
}

function jobLocation(job) {
  const loc = job && job.location;
  if (!loc) return job && job.remote ? 'Remote' : '';
  if (typeof loc === 'string') return loc.trim();
  if (typeof loc === 'object') {
    const joined = [loc.name, loc.city, loc.region, loc.country].filter((part) => typeof part === 'string' && part.trim()).join(', ');
    if (joined) return joined;
    return String(loc.location || '');
  }
  return '';
}

function huntJobBody(job) {
  if (!job) return null;
  const url = String(job.url || job.posting || job.linkedin || '').trim();
  if (!url) return null;
  return {
    url,
    title: job.title || '',
    company: job.company || '',
    posting: job.posting || url,
    linkedin: job.linkedin || '',
    location: jobLocation(job),
    apply_surface: job.apply_surface || (job.url ? 'form' : ''),
    jd: job.jdText || job.jd || '',
    jdSource: job.jdSource || '',
  };
}

async function runIngestHunt(payload, { promptText, Agent, extractText: extract, huntCall: callFn, signal } = {}) {
  const throwIfAborted = () => {
    if (signal && signal.aborted) throw huntCancelledError();
  };
  throwIfAborted();
  const plan = normalizeSchema(payload && payload.schema);
  if (!(Number(plan.n) >= 1)) {
    return {
      ok: false,
      missingCount: true,
      added: 0,
      jobs: [],
      urls: [],
      reply: 'Search plan is missing a count.',
    };
  }
  const port = controlPort(payload);
  const call = callFn || ((op, body) => huntCall(port, op, body));
  const traces = [];
  const tools = huntTools({ port, traces, call });
  const boards = loadHuntBoards();
  const starts = huntStartUrls(plan, { boards });
  const beginOut = await call('begin', {
    schema: plan,
    starts,
    deferOpen: true,
    resume: Boolean(payload && payload.resume),
  });
  const jsonDone = Boolean(beginOut && beginOut.jsonDone);
  const jsonSites = (plan.sites || []).filter((s) => JSON_BOARD_SITES.has(String(s || '').toLowerCase()));
  if (!jsonDone && !process.env.NODE_TEST_CONTEXT && jsonSites.length && boards.length) {
    throwIfAborted();
    const found = await huntJobs({
      boards: boards.filter((b) => jsonSites.includes(String((b && b.ats) || '').toLowerCase())),
      extraJobs: loadHuntJobs(),
      schema: plan,
      fetch: globalThis.fetch,
    });
    for (const job of found.jobs || []) {
      throwIfAborted();
      const body = huntJobBody(job);
      if (body) await call('add', body);
    }
    await call('progress', { jsonDone: true });
  }
  let last = (beginOut && beginOut.last) || '';
  let status = await call('status', {});
  const href = String((beginOut && beginOut.href) || '').trim();
  if (Number(status.added) < plan.n) {
    const openUrl = href || (starts[0] && starts[0].url);
    if (openUrl) await call('open', { url: openUrl });
  }
  const maxRounds = Math.max(4, Math.min(20, Math.ceil(plan.n / 4) + 4));
  const startRound = Math.max(0, Math.min(maxRounds, Number(beginOut && beginOut.round) || 0));
  const runPrompt = promptText;
  if (typeof runPrompt !== 'function') throw new Error('hunt needs Cursor');
  for (let round = startRound; round < maxRounds; round += 1) {
    throwIfAborted();
    status = await call('status', {});
    if (Number(status.added) >= plan.n) break;
    if (!starts.length) break;
    const prompt = huntPrompt({ plan, starts, status, round, last });
    const result = await runPrompt(Agent, prompt, {
      name: 'jobmagnet-hunt',
      tools: ['mcp'],
      customTools: tools,
      signal,
    });
    throwIfAborted();
    last = (extract || defaultExtract)(result) || '';
    await call('progress', { round: round + 1, last });
    status = await call('status', {});
    if (Number(status.added) >= plan.n) break;
    if (round > 0 && /exhausted|no more matches|done hunting/i.test(last)) break;
  }
  status = await call('status', {});
  const n = Number(status.added) || 0;
  return {
    ok: true,
    added: n,
    dupes: Number(status.dupes) || 0,
    jobs: status.jobs || [],
    urls: status.urls || [],
    jds: Number(status.jds) || 0,
    reply: n
      ? `Added ${n} new listing${n === 1 ? '' : 's'} via logged-in hunt.`
      : last || 'Hunt finished with 0 new matches.',
    tools: traces,
    plan: describeHuntPlan(plan, boards),
  };
}

async function executeSearchPlan(schema, extra = {}) {
  if (process.env.MAGNET_AGENT_HOST === '1') {
    throw new Error('executeSearchPlan runs in Electron');
  }
  const client = require('./agent-client');
  const ev = await client.invoke(
    'ingest-hunt',
    {
      schema,
      controlPort: Number(process.env.MAGNET_PORT || 3871),
      resume: Boolean(extra.resume),
    },
    {
      timeout: extra.timeout || 20 * 60 * 1000,
      key: extra.key || require('./chat-tabs').INGEST_KEY,
      signal: extra.signal,
    }
  );
  if (ev && ev.cancelled) {
    const err = new Error('fill cancelled');
    err.cancelled = true;
    throw err;
  }
  return ev.result || ev;
}

module.exports = { huntCall, huntTools, huntPrompt, runIngestHunt, executeSearchPlan };
