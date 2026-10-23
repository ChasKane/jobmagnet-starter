#!/usr/bin/env node
/**
 * Essay turn. Host loads this as a library; CLI remains for debugging.
 */
const fs = require('fs');
const path = require('path');
const { loadRichboi, loadSystemPrompt } = require('./essay-prompt');
const { formatCardForDraft } = require('./products');
const { runCascade, completeModelTurn, loadTurnBodies, loadTurnVoice, draftToolOpts } = require('./cascade');
const {
  buildClassifyPrompt,
  buildWhyRolePrompt,
  bucketsFromText,
  guessBuckets,
  shouldRouteWhyRole,
} = require('./essay-buckets');
const { newRequestId } = require('./action-log');
const graph = require('./graph');
const { seedVoiceFromFile } = require('./graph');
const { extractText } = require('./extract-text');
const { retrieveForDraft } = require('./retrieve');

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

function scrubDraft(row) {
  if (!row || typeof row !== 'object') return row;
  const key = typeof row.text === 'string' ? 'text' : typeof row.reply === 'string' ? 'reply' : '';
  if (!key) return row;
  const cleaned = row[key].replace(/\u2014/g, '--');
  if (cleaned === row[key]) return row;
  return { ...row, [key]: cleaned };
}

function packOut(out, payload) {
  const { normalizeAsks } = require('./chat-tools');
  const parsed = out.parsed || {};
  parsed.asks = [...(out.asks || []), ...normalizeAsks(parsed.asks)];
  parsed.tools = out.tools || [];
  const drafts = (parsed.drafts || []).filter((a) => a && (a.text || a.reply)).map(scrubDraft);
  const experience_updates = Array.isArray(parsed.experience_updates) ? parsed.experience_updates : [];
  const profile_updates = Array.isArray(parsed.profile_updates) ? parsed.profile_updates : [];
  const instruction = String(payload.instruction || '').trim();
  const needOutput = !instruction && Array.isArray(payload.fields) && payload.fields.length;
  const hasReply = String(parsed.reply || '').trim();
  if (needOutput && !drafts.some((a) => a.text) && !hasReply) {
    const err = new Error('essay-draft: model returned no drafts or reply');
    throw err;
  }
  return {
    reply: parsed.reply || '',
    drafts,
    experience_updates,
    profile_updates,
    asks: parsed.asks || [],
    tools: parsed.tools || [],
    prompt: out.prompt,
    raw: out.raw,
    request_id: out.request_id,
    selected: out.selected,
    retrieved: Boolean(payload.retrieved),
  };
}

async function runEssayTurn(payload, deps) {
  if (deps.signal && deps.signal.aborted) {
    const err = new Error('fill cancelled');
    err.cancelled = true;
    throw err;
  }
  graph.ensureOpen();
  seedVoiceFromFile(loadRichboi());
  const requestId = deps.requestId || payload.request_id || newRequestId();
  const next = { ...deps, requestId, extractText: deps.extractText || extractText };
  const got = retrieveForDraft(payload);
  if (got.block) {
    payload.retrieved = got.block;
    if (next.onProgress) next.onProgress({ stage: 'retrieve', detail: 'Retrieving…', busy: '' });
  }
  if (got.cards && got.cards.length) {
    payload.retrieveCardIds = got.cards.map((c) => c.id).filter(Boolean);
  }
  const sendDraft = deps.sendChat
    ? async (prompt, opts = {}) => deps.sendChat(prompt, { stream: false, signal: deps.signal, ...opts })
    : null;
  const turnDeps = { ...next, sendDraft };
  const fields = Array.isArray(payload.fields) ? payload.fields.filter((field) => field && field.id) : [];
  if (!shouldRouteWhyRole(payload.instruction) || !fields.length) {
    const out = await runCascade(payload, turnDeps);
    return packOut(out, payload);
  }
  if (next.onProgress) next.onProgress({ stage: 'classify', detail: 'Classifying questions…', busy: '' });
  let buckets;
  try {
    const classified = await completeModelTurn(buildClassifyPrompt(fields), payload, {
      ...turnDeps,
      tools: [],
      kind: 'essay.classify',
      onDrafts: null,
    });
    buckets = bucketsFromText(classified.raw, fields);
  } catch {
    buckets = guessBuckets(fields);
  }
  const why = fields.filter((field) => buckets.get(field.id) === 'why-role');
  const standard = fields.filter((field) => buckets.get(field.id) !== 'why-role');
  const parts = [];
  if (why.length) {
    if (next.onProgress) next.onProgress({ stage: 'why-role', detail: 'Why this role…', busy: '' });
    const whyPayload = { ...payload, fields: why };
    const prompt = buildWhyRolePrompt({
      system: loadSystemPrompt(),
      voice: loadTurnVoice(whyPayload),
      company: payload.company,
      title: payload.title,
      jd: (payload.jd && payload.jd.text) || payload.jd || '',
      fields: why,
      cards: loadTurnBodies(whyPayload).map((card) => formatCardForDraft(card)).join('\n\n') || '(no cards)',
      instruction: payload.instruction,
    });
    parts.push(await completeModelTurn(prompt, whyPayload, { ...turnDeps, kind: 'essay.why-role' }));
  }
  if (standard.length) {
    parts.push(await runCascade({ ...payload, fields: standard }, turnDeps));
  }
  if (!parts.length) {
    const out = await runCascade(payload, turnDeps);
    return packOut(out, payload);
  }
  const merged = {
    parsed: {
      reply: parts.map((part) => (part.parsed && part.parsed.reply) || '').filter(Boolean).join('\n\n'),
      drafts: parts.flatMap((part) => (part.parsed && part.parsed.drafts) || []),
      experience_updates: parts.flatMap((part) => (part.parsed && part.parsed.experience_updates) || []),
      profile_updates: parts.flatMap((part) => (part.parsed && part.parsed.profile_updates) || []),
      asks: parts.flatMap((part) => (part.parsed && part.parsed.asks) || []),
    },
    asks: parts.flatMap((part) => part.asks || []),
    tools: parts.flatMap((part) => part.tools || []),
    prompt: parts.map((part) => part.prompt || '').filter(Boolean).join('\n\n'),
    raw: parts.map((part) => part.raw || '').join('\n'),
    request_id: parts[0] && parts[0].request_id,
    selected: parts.flatMap((part) => part.selected || []),
  };
  return packOut(merged, payload);
}

async function main() {
  loadDotEnv();
  const raw = fs.readFileSync(0, 'utf8');
  const payload = JSON.parse(raw || '{}');
  const requestId = payload.request_id || newRequestId();

  if (!process.env.CURSOR_API_KEY) {
    process.stderr.write('essay-draft: missing CURSOR_API_KEY in projects/jobmagnet/.env\n');
    process.exit(1);
  }

  let Agent;
  try {
    ({ Agent } = require('@cursor/sdk'));
  } catch {
    process.stderr.write('essay-draft: @cursor/sdk not installed\n');
    process.exit(1);
  }

  const { promptText } = require('./cursor-agent');
  const onProgress = (info) => {
    try {
      process.stderr.write(`MAGNET_PROGRESS ${JSON.stringify(info)}\n`);
    } catch (_) {}
  };
  const out = await runEssayTurn(payload, { promptText, Agent, requestId, extractText, onProgress });
  process.stdout.write(JSON.stringify(out));
}

module.exports = { extractText, runEssayTurn, scrubDraft, packOut, draftToolOpts };

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  });
}
