#!/usr/bin/env node
/**
 * Sidecar: is this page text a real job description, and is the URL already the form?
 * stdin JSON { text, href, title, ctas } → stdout JSON { has_jd, apply_surface, apply_cta, reason }.
 */
const fs = require('fs');
const path = require('path');
const { buildJdJudgePrompt, parseJdJudge } = require('./jd');
const { extractText } = require('./extract-text');

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

async function runJdJudge(payload, { promptText, Agent, extractText: extract } = {}) {
  const text = String((payload && payload.text) || '').trim();
  if (!text) return { has_jd: false, reason: 'blank' };
  const result = await promptText(Agent, buildJdJudgePrompt(text, payload), {
    name: 'jobmagnet-jd',
    tools: [],
  });
  return parseJdJudge((extract || extractText)(result)) || { has_jd: null, reason: 'unparsed' };
}

async function main() {
  loadDotEnv();
  const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const text = String(payload.text || '').trim();
  if (!text) {
    process.stdout.write(JSON.stringify({ has_jd: false, reason: 'blank' }));
    return;
  }
  if (!process.env.CURSOR_API_KEY) {
    process.stdout.write(JSON.stringify({ has_jd: null, reason: 'no-key' }));
    return;
  }
  let Agent;
  try {
    ({ Agent } = require('@cursor/sdk'));
  } catch {
    process.stdout.write(JSON.stringify({ has_jd: null, reason: 'no-sdk' }));
    return;
  }
  const { promptText } = require('./cursor-agent');
  const parsed = await runJdJudge(payload, { promptText, Agent });
  process.stdout.write(JSON.stringify(parsed));
}

module.exports = { runJdJudge };

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(JSON.stringify({ has_jd: null, reason: String((err && err.message) || err) }));
  });
}
