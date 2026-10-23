#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const graph = require('./graph');
const { isEligibleFinal, applyRulesToVoice, hasProperNoun } = require('./voice-rules');
const { compileFinals } = require('./compile');
const { wantLlmVoice, llmProposeVoiceRules } = require('./voice-learn');
const { append } = require('./action-log');
const { loadRichboi, saveRichboi } = require('./essay-prompt');

const ANSWERS = path.join(__dirname, '..', 'knowledge', 'archive', 'answers.jsonl');

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

function loadRows() {
  if (!fs.existsSync(ANSWERS)) return [];
  return fs
    .readFileSync(ANSWERS, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function compactFromRows(rows) {
  graph.ensureOpen();
  graph.seedVoiceFromFile(loadRichboi());
  const eligible = (rows || []).filter(isEligibleFinal);
  await compileFinals(eligible);
  const batch = eligible.slice(-12);
  if (wantLlmVoice()) {
    try {
      const current = graph.currentVoice();
      const extracted = await llmProposeVoiceRules(batch, {
        voice: (current && current.text) || loadRichboi(),
      });
      for (const rule of extracted) {
        if (hasProperNoun(rule.text)) continue;
        graph.upsertPendingRule(rule.id, rule.text);
      }
    } catch (err) {
      console.warn('[magnet] voice learn:', (err && err.message) || err);
    }
  }
  const pending = graph.pendingRules();
  const unique = pending.length;
  const confirmed = pending.filter((p) => p.count >= 3);
  const shouldPropose = unique >= 3 || confirmed.length >= 1 || (eligible.length >= 5 && unique >= 1);
  if (!shouldPropose) return { proposed: false, pending };
  const current = graph.currentVoice();
  const next = applyRulesToVoice((current && current.text) || loadRichboi(), pending);
  if (hasProperNoun(next)) return { proposed: false, pending, reason: 'nouns' };
  append({
    request_id: `voice-${Date.now()}`,
    kind: 'voice.propose',
    summary: `${pending.length} pending rules`,
    blobs: { critique: pending },
  });
  return { proposed: true, pending, next, current: current && current.text };
}

function acceptPending({ asKind } = {}) {
  graph.ensureOpen();
  const pending = graph.pendingRules();
  if (!pending.length) return graph.currentVoice();
  const current = graph.currentVoice();
  const next = applyRulesToVoice((current && current.text) || loadRichboi(), pending);
  const row = graph.addVoiceVersion({
    kind: asKind || 'compact',
    text: next,
    parent_id: current && current.id,
  });
  graph.clearPending();
  saveRichboi(next);
  append({
    request_id: `voice-${Date.now()}`,
    kind: 'voice.save',
    summary: row.kind,
    extra: { voice_id: row.id },
  });
  return row;
}

function saveUserVoice(text) {
  graph.ensureOpen();
  const current = graph.currentVoice();
  const row = graph.addVoiceVersion({
    kind: 'user',
    text: String(text ?? ''),
    parent_id: current && current.id,
  });
  saveRichboi(row.text);
  append({
    request_id: `voice-${Date.now()}`,
    kind: 'voice.save',
    summary: 'user',
    extra: { voice_id: row.id },
  });
  return row;
}

function revertVoice(id) {
  graph.ensureOpen();
  const target = graph.voiceById(id);
  if (!target) return null;
  const current = graph.currentVoice();
  const row = graph.addVoiceVersion({
    kind: 'revert',
    text: target.text,
    parent_id: current && current.id,
  });
  saveRichboi(row.text);
  return row;
}

async function main() {
  loadDotEnv();
  await compactFromRows(loadRows());
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(0);
  });
}

module.exports = { compactFromRows, acceptPending, saveUserVoice, revertVoice, loadRows };
