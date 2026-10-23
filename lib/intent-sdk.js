#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
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

function intentPrompt(message) {
  return `Parse this JobMagnet ingest chat into JSON only, no markdown:
{"action":"find"|"add_urls"|"edit"|"connect_mail"|"scan_mail","n":10,"criteria":{"title_includes":[],"remote":true,"salary_min":null,"exclude_industries":[],"company":null},"urls":[],"edit":{"remove_companies":[],"add_exclude_industries":[]}}
Message:
${message}`;
}

async function parseIntentLlm(message, { promptText, Agent, extractText: extract } = {}) {
  const take = extract || extractText;
  const result = await promptText(Agent, intentPrompt(message), { name: 'jobmagnet-intent', tools: [] });
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
  const { promptText } = require('./cursor-agent');
  const out = await parseIntentLlm(payload.message, { promptText, Agent });
  process.stdout.write(JSON.stringify(out));
}

module.exports = { parseIntentLlm, intentPrompt };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
