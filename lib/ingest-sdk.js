#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { addUrlsFromText, editList } = require('./discover');
const { listLiveJobs } = require('./live-jobs');
const { CHAT_TOOLS, sharedCustomTools, slimTrace, recordTrace } = require('./chat-tools');
const { extractText: defaultExtract } = require('./extract-text');
const { fromToolArgs, formatPlanReply } = require('../packages/core/src/search-schema');
const { formatCompanyHeld } = require('../packages/core/src/company-hold');

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

const extractText = defaultExtract;

function loadBoards() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().listBoards();
  }
  const file = path.join(__dirname, '..', 'knowledge', 'boards.yaml');
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    return Array.isArray(doc.boards) ? doc.boards : [];
  } catch {
    return [];
  }
}

function applicantUserText(payload) {
  const hist = Array.isArray(payload && payload.history) ? payload.history : [];
  const bits = [];
  for (const m of hist) {
    if (!m) continue;
    if (m.role === 'you' || m.role === 'Applicant') bits.push(String(m.text || ''));
  }
  bits.push(String((payload && payload.message) || ''));
  return bits.filter((s) => String(s).trim()).join('\n');
}

function storyRows(args) {
  if (Array.isArray(args && args.stories)) return args.stories;
  if (Array.isArray(args && args.updates)) return args.updates;
  if (args && (args.text || args.employer)) return [args];
  return [];
}

async function fileIngestStories(stories, state) {
  const { splitExperienceUpdates, applyUpdates } = require('./profile-facts');
  const { applyExperienceUpdates } = require('./employment');
  const { magnetWouldWrite } = require('./compile');
  const split = splitExperienceUpdates(stories);
  const profile = split.profile.length ? applyUpdates(split.profile) : [];
  const patches = await applyExperienceUpdates(split.cards, {
    userText: (state && state.userText) || '',
    source: 'chat',
  });
  if (state && state.actions) {
    state.actions.experience_updates = split.cards;
    state.actions.profile_updates = profile;
    state.actions.story_patches = patches;
  }
  const filed = (patches || []).filter((p) => p && p.kind && p.kind !== 'no-op').length;
  const skipped = magnetWouldWrite(split.cards, (state && state.userText) || '');
  if (filed) return `Filed ${filed} work note${filed === 1 ? '' : 's'}.`;
  if (skipped.length) return 'Did not file: quotes must match the applicant’s wording.';
  return 'Nothing to file.';
}

function withStoryReply(reply, traces) {
  const text = String(reply || '').trim() || 'Okay.';
  const hit = [...(traces || [])].reverse().find((t) => t && t.name === 'save_story');
  const bit = hit && String(hit.result || '').trim();
  if (!bit || !/^(Filed |Did not file)/.test(bit)) return text;
  if (text.includes(bit.slice(0, 24))) return text;
  return text === 'Okay.' ? bit : `${text}\n\n${bit}`;
}

function ingestTools(state) {
  const { traces, actions, asks } = state;
  return {
    ...sharedCustomTools(state),
    save_story: {
      description:
        'Save work-story facts the applicant just said onto career cards. Quote their wording. Do not invent. Call this when they tell you what they built, owned, or shipped — even if they also asked to hunt or add URLs.',
      inputSchema: {
        type: 'object',
        properties: {
          stories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                employer: { type: 'string' },
                text: { type: 'string', description: 'Quoted applicant wording' },
              },
              required: ['text'],
            },
          },
        },
        required: ['stories'],
      },
      annotations: { title: 'Save work story' },
      async execute(args) {
        try {
          const { splitExperienceUpdates, applyUpdates } = require('./profile-facts');
          const { storyConfirmAsks } = require('./story-confirm');
          const { magnetWouldWrite, parkExtracted } = require('./compile');
          const split = splitExperienceUpdates(storyRows(args));
          if (split.profile.length) applyUpdates(split.profile);
          if (state && state.actions) {
            state.actions.experience_updates = split.cards;
            state.actions.profile_updates = split.profile;
          }
          if (!split.cards.length) {
            const out = 'Nothing to file.';
            recordTrace(traces, 'save_story', args, out);
            return out;
          }
          const userText = (state && state.userText) || '';
          const unquoted = magnetWouldWrite(split.cards, userText);
          const quoted = split.cards.filter((c) => !unquoted.includes(c));
          const parked = unquoted.length ? await parkExtracted(unquoted, { userText, source: 'chat' }) : [];
          const next = [...storyConfirmAsks(quoted), ...storyConfirmAsks(parked)];
          (asks || []).push(...next);
          const out = 'Shown in chat — Keep, edit employer, or Skip.';
          recordTrace(traces, 'save_story', args, out);
          return out;
        } catch (err) {
          const out = String((err && err.message) || err);
          recordTrace(traces, 'save_story', args, out);
          return out;
        }
      },
    },
    list_jobs: {
      description: 'List jobs already in the JobMagnet sidebar (company, title, url).',
      inputSchema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'number' } } },
      annotations: { title: 'List jobs', readOnlyHint: true },
      execute(args) {
        const q = String(args.q || '').toLowerCase();
        const limit = Math.min(Number(args.limit) || 40, 80);
        let rows = [];
        try {
          rows = listLiveJobs()
            .filter((j) => {
              if (!q) return true;
              return `${j.company} ${j.title} ${j.url}`.toLowerCase().includes(q);
            })
            .slice(0, limit)
            .map((j) => `${j.company || j.name} · ${j.title} · ${j.url}`);
        } catch (err) {
          const out = String((err && err.message) || err);
          recordTrace(traces, 'list_jobs', args, out);
          return out;
        }
        const out = rows.length ? rows.join('\n') : 'No jobs match.';
        recordTrace(traces, 'list_jobs', args, out);
        return out;
      },
    },
    list_boards: {
      description: 'List learned ATS boards used by find_jobs.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'List boards', readOnlyHint: true },
      execute() {
        const boards = loadBoards().map((b) => `${b.company || b.slug} · ${b.ats}/${b.slug}`);
        const out = boards.length ? boards.join('\n') : 'No boards yet. Paste Greenhouse / Ashby / Lever URLs.';
        recordTrace(traces, 'list_boards', {}, out);
        return out;
      },
    },
    add_urls: {
      description:
        'Add apply or posting URLs to the job list and capture JDs when public. A company already on the list is skipped.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text containing one or more http(s) URLs' } },
        required: ['text'],
      },
      async execute(args) {
        const text = String(args.text || '');
        const r = await addUrlsFromText(text);
        actions.add_urls = r;
        const heldBit = formatCompanyHeld(r.companyHeld);
        const out = `Added ${r.added}, ${r.dupes} dupes.${heldBit ? ` ${heldBit}` : ''}${r.jds ? ` Captured ${r.jds} JDs.` : ''}`;
        recordTrace(traces, 'add_urls', args, out);
        return out;
      },
    },
    find_jobs: {
      description:
        'Propose a search program (sites, age, keywords, pay, n). Always include linkedin unless they opted out. Also include weworkremotely, remoteok, himalayas, remotive, jobicy, workingnomads, justremote, dynamitejobs, nodesk, 4dayweek, remoters, realworkfromanywhere, and remotecurrent unless they opted out. Do not hunt until they hit Go.',
      inputSchema: {
        type: 'object',
        properties: {
          n: { type: 'number' },
          title_includes: { type: 'array', items: { type: 'string' } },
          keywords: { type: 'array', items: { type: 'string' } },
          sites: { type: 'array', items: { type: 'string' } },
          max_age_days: { type: 'number' },
          remote: { type: 'boolean' },
          salary_min: { type: 'number' },
          exclude_industries: { type: 'array', items: { type: 'string' } },
          company: { type: 'string' },
        },
      },
      execute(args) {
        const schema = fromToolArgs({
          n: args.n,
          titleIncludes: args.title_includes,
          keywords: args.keywords,
          sites: args.sites,
          maxAgeDays: args.max_age_days,
          remote: args.remote,
          salaryMin: args.salary_min,
          excludeIndustries: args.exclude_industries,
          company: args.company,
        });
        actions.search_plan = schema;
        const out = `${formatPlanReply(schema, loadBoards())} Wait for the applicant to hit Go.`;
        recordTrace(traces, 'find_jobs', args, out);
        return out;
      },
    },
    edit_list: {
      description: 'Remove companies or add excluded industries on the job list.',
      inputSchema: {
        type: 'object',
        properties: {
          remove_companies: { type: 'array', items: { type: 'string' } },
          add_exclude_industries: { type: 'array', items: { type: 'string' } },
        },
      },
      execute(args) {
        const r = editList({
          remove_companies: args.remove_companies || [],
          add_exclude_industries: args.add_exclude_industries || [],
        });
        actions.edit_list = r;
        const out = `Removed ${r.removed} rows.`;
        recordTrace(traces, 'edit_list', args, out);
        return out;
      },
    },
    connect_mail: {
      description: 'Start Gmail OAuth so Magnet can scan the inbox for rejections.',
      inputSchema: { type: 'object', properties: {} },
      execute() {
        actions.needConnect = true;
        recordTrace(traces, 'connect_mail', {}, 'Opening Gmail sign-in…');
        return 'Main process will open Gmail sign-in.';
      },
    },
    scan_mail: {
      description: 'Scan the connected Gmail inbox for application replies / rejections.',
      inputSchema: { type: 'object', properties: {} },
      execute() {
        actions.needScan = true;
        recordTrace(traces, 'scan_mail', {}, 'Scanning inbox…');
        return 'Main process will scan the inbox.';
      },
    },
  };
}

function buildPrompt(payload) {
  const history = Array.isArray(payload.history) ? payload.history : [];
  const hist = history
    .slice(-20)
    .map((m) => `${m.role === 'you' ? 'Applicant' : 'Magnet'}: ${String(m.text || '').slice(0, 800)}`)
    .join('\n');
  return `You are Magnet ingest chat. Compile a search program from the applicant's description (sites including LinkedIn, listing age, JD keywords, title, remote, pay). n comes from the applicant. Leave n unset when they did not give a count. Do not invent a count. A company already on the list is skipped, including when they name that company or ask for another opening there.

Use tools. Prefer add_urls when they pasted links. Call find_jobs to draft the plan — do not hunt until they hit Go in the UI. After Go, Magnet drives their signed-in browser; you only compile the plan here. If they stated a work-story (what they built, owned, shipped, a constraint, an outcome), call save_story quoting them closely — even when they also asked to hunt or paste URLs. Do not invent. Closed facts (age, skill years, pay, work auth) are not stories. Use webSearch / webFetch only to clarify a company or board. Use askQuestion when a choice is needed. Use list_jobs / list_boards before claiming the list is empty. For Gmail, call connect_mail or scan_mail immediately. Never say those tools are unavailable.

Do not invent URLs. After tools run, reply in short plain text (no JSON, no markdown fence) summarizing the plan, what you added, or what you filed.

${hist ? `Recent ingest chat:\n${hist}\n` : ''}Applicant: ${payload.message}`;
}

function ingestTurnCancelled() {
  const err = new Error('fill cancelled');
  err.cancelled = true;
  return err;
}

async function runIngestTurn(payload, { promptText, Agent, extractText: extract, signal } = {}) {
  if (signal && signal.aborted) throw ingestTurnCancelled();
  const traces = [];
  const asks = [];
  const actions = {};
  const userText = applicantUserText(payload || {});
  const prompt = buildPrompt(payload || {});
  const extra = {
    name: 'jobmagnet-ingest',
    tools: CHAT_TOOLS,
    customTools: ingestTools({ traces, asks, actions, userText, message: (payload && payload.message) || '' }),
    signal,
  };
  const result = await promptText(Agent, prompt, extra);
  if (signal && signal.aborted) throw ingestTurnCancelled();
  const reply = withStoryReply((extract || extractText)(result) || 'Okay.', traces);
  return {
    ok: true,
    reply,
    tools: traces,
    asks,
    actions,
    prompt,
    raw: slimTrace(result, 4000),
  };
}

async function main() {
  loadDotEnv();
  const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  if (!process.env.CURSOR_API_KEY) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'missing CURSOR_API_KEY' }));
    return;
  }
  let Agent;
  try {
    ({ Agent } = require('@cursor/sdk'));
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: 'sdk missing' }));
    return;
  }
  const { promptText } = require('./cursor-agent');
  const out = await runIngestTurn(payload, { promptText, Agent });
  process.stdout.write(JSON.stringify(out));
}

async function executeSearchPlan(schema, extra) {
  return require('./hunt-sdk').executeSearchPlan(schema, extra);
}

module.exports = {
  runIngestTurn,
  buildPrompt,
  ingestTools,
  extractText,
  executeSearchPlan,
  applicantUserText,
  fileIngestStories,
  withStoryReply,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  });
}
