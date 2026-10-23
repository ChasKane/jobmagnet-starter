#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const p = path.join(__dirname, '..', '..', '.env');
  try {
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) {}
}

const { extractText } = require('../extract-text');

function classifyPrompt(payload) {
  return `Classify this recruiting email. JSON only, no markdown:
{"verdict":"reject"|"not_reject"|"unsure","company":"","title":"","confidence":0.0}
reject = employer definitely declined this candidate. not_reject = receipt, interview, OA, inbound, or newsletter. unsure = cannot tell.
From: ${payload.from || ''}
Subject: ${payload.subject || ''}
Candidates: ${JSON.stringify(payload.candidates || [])}
Body:
${String(payload.text || '').slice(0, 4000)}`;
}

async function runClassify(payload, { promptText, Agent, extractText: extract } = {}) {
  const { promptText: pt } = promptText ? { promptText } : require('../cursor-agent');
  const take = extract || extractText;
  const result = await pt(Agent, classifyPrompt(payload || {}), { name: 'jobmagnet-mail', tools: [] });
  const text = take(result);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : '{}';
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function main() {
  loadDotEnv();
  const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  let Agent;
  try {
    ({ Agent } = require('@cursor/sdk'));
  } catch {
    process.stdout.write('{}');
    return;
  }
  if (!process.env.CURSOR_API_KEY) {
    process.stdout.write('{}');
    return;
  }
  const { promptText } = require('../cursor-agent');
  const out = await runClassify(payload, { promptText, Agent });
  process.stdout.write(JSON.stringify(out));
}

module.exports = { runClassify, classifyPrompt };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
