#!/usr/bin/env node
/**
 * Sidecar: one critic pass over residual fields. stdin JSON, stdout JSON
 * { reply, fills, asks, runs, recipes, profile_updates, prompt }. No write tools.
 */
const fs = require('fs');
const path = require('path');
const { buildReviewPrompt } = require('./review-prompt');
const { extractText: defaultExtract } = require('./extract-text');

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

function parseReviewJson(blob) {
  const text = String(blob || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('fill-review: model returned no JSON');
  const obj = JSON.parse(text.slice(start, end + 1));
  const fills = Array.isArray(obj.fills) ? obj.fills : [];
  const asks = Array.isArray(obj.asks) ? obj.asks : [];
  const runs = Array.isArray(obj.runs) ? obj.runs : [];
  const recipes = Array.isArray(obj.recipes) ? obj.recipes : [];
  const profile_updates = Array.isArray(obj.profile_updates) ? obj.profile_updates : [];
  return {
    reply: String(obj.reply || ''),
    fills: fills
      .filter((f) => f && f.id && f.value != null)
      .map((f) => ({
        id: String(f.id),
        value: String(f.value),
        fallbacks: Array.isArray(f.fallbacks) ? f.fallbacks.map(String) : [],
        reason: String(f.reason || ''),
        steps: Array.isArray(f.steps) ? f.steps : [],
        class_id: f.class_id || f.class ? String(f.class_id || f.class) : '',
      })),
    asks: asks
      .filter((a) => a && a.question)
      .map((a) => ({
        id: a.id ? String(a.id) : '',
        question: String(a.question),
        why: String(a.why || ''),
      })),
    runs: runs
      .filter((r) => r && r.id && r.source)
      .map((r) => ({
        id: String(r.id),
        source: String(r.source),
        explain: String(r.explain || ''),
        why_not_steps: String(r.why_not_steps || ''),
      })),
    recipes: recipes
      .filter((r) => r && (r.label || r.field_id) && !r.run && !(r.source && /function|eval|document\./i.test(String(r.source))))
      .map((r, i) => ({
        id: String(r.id || r.field_id || `recipe-${i}`),
        field_id: r.field_id ? String(r.field_id) : '',
        label: String(r.label || ''),
        label_includes: Array.isArray(r.label_includes) ? r.label_includes.map(String) : [],
        profile_key: r.profile_key ? String(r.profile_key) : '',
        value: r.value != null ? String(r.value) : '',
        steps: Array.isArray(r.steps) ? r.steps : [],
        reason: String(r.reason || ''),
      })),
    profile_updates: profile_updates
      .filter((u) => u && typeof u === 'object' && (u.path || u.key) && !u.employer && u.value != null)
      .map((u) => ({
        path: String(u.path || u.key),
        value: u.value,
        class_id: u.class_id || u.class ? String(u.class_id || u.class) : '',
        id: u.id ? String(u.id) : '',
        label: u.label ? String(u.label) : '',
      })),
  };
}

async function runFillReview(input, { promptText, Agent, extractText: extract, sendChat } = {}) {
  const { prompt, payload } = buildReviewPrompt(input || {});
  const take = extract || extractText;
  let blob;
  if (typeof sendChat === 'function') {
    const sent = await sendChat(prompt);
    blob = typeof sent === 'string' ? sent : take(sent) || '';
  } else {
    const result = await promptText(Agent, prompt, { name: 'jobmagnet-fill-review', tools: [] });
    blob = take(result) || JSON.stringify(result || '');
  }
  const parsed = parseReviewJson(blob);
  return {
    kind: 'review',
    reply: parsed.reply,
    fills: parsed.fills,
    asks: parsed.asks,
    runs: parsed.runs,
    recipes: parsed.recipes,
    profile_updates: parsed.profile_updates,
    prompt,
    payload,
    raw: blob,
  };
}

async function main() {
  loadDotEnv();
  const raw = fs.readFileSync(0, 'utf8');
  const input = JSON.parse(raw || '{}');
  if (!process.env.CURSOR_API_KEY) {
    process.stderr.write('fill-review: missing CURSOR_API_KEY in projects/jobmagnet/.env\n');
    process.exit(1);
  }
  let Agent;
  try {
    ({ Agent } = require('@cursor/sdk'));
  } catch {
    process.stderr.write('fill-review: @cursor/sdk not installed\n');
    process.exit(1);
  }
  const { promptText } = require('./cursor-agent');
  const out = await runFillReview(input, { promptText, Agent });
  process.stdout.write(JSON.stringify(out));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  });
}

module.exports = { parseReviewJson, runFillReview };
