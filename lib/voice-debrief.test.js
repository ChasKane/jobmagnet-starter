const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `magnet-debrief-${process.pid}.sqlite`);
process.env.MAGNET_DB = dbFile;
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-db-${process.pid}`);
process.env.MAGNET_VOICE_FILE = path.join(os.tmpdir(), `magnet-voice-db-${process.pid}.md`);
process.env.MAGNET_HEURISTIC_COMPILE = '1';
process.env.MAGNET_HEURISTIC_VOICE = '1';

const store = require('./store');
const graph = require('./graph');
const {
  parseDebriefJson,
  sanitizeRules,
  cannedAsks,
  parseCannedChoice,
  acceptLessons,
  skipLessons,
  saveDebriefVoice,
  formatAcceptReply,
  runDebriefOpen,
  eligiblePairs,
  buildDebriefOpenPrompt,
} = require('./voice-debrief');
const { saveUserVoice } = require('./voice-compact');

function reset() {
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  store.close();
  store.open(dbFile);
  fs.writeFileSync(process.env.MAGNET_VOICE_FILE, 'Be specific. No career tour.\n');
}

const rewrite = {
  origin: 'rewrite',
  label: 'Why this role',
  llm_draft: 'I walked three employers and closed with generic enthusiasm.',
  final:
    'I already do this with a job-application auto-filler. Describe the tool; do not name it. Short, uneven, no career tour.',
};

test('eligiblePairs drops magnet-unchanged rows', () => {
  assert.equal(
    eligiblePairs([
      rewrite,
      { origin: 'magnet', label: 'Why', final: 'x'.repeat(80) },
      { origin: 'edit', label: 'Gender', final: 'x'.repeat(80) },
    ]).length,
    1
  );
});

test('parseDebriefJson keeps rules and drops proper nouns', () => {
  const parsed = parseDebriefJson(
    '{"reply":"You opened with a tour.","voice_rules":[{"id":"no-tour","text":"Do not open with a career tour."},{"id":"lupe","text":"Prefer Lupe for pride questions"}],"bindings":[{"question_shape":"why-us","tag":"ops-platform"}]}'
  );
  assert.match(parsed.reply, /tour/);
  assert.equal(parsed.voice_rules.length, 1);
  assert.match(parsed.voice_rules[0].text, /career tour/);
  assert.equal(parsed.bindings[0].tag, 'ops-platform');
});

test('sanitizeRules caps at 3 and strips nouns', () => {
  const rules = sanitizeRules([
    { text: 'Do not open with a career tour.' },
    { text: 'Prefer Lupe for pride.' },
    { text: 'Uneven length is correct.' },
    { text: 'Echo the posting phrasing.' },
    { text: 'A fourth would be too many.' },
  ]);
  assert.equal(rules.length, 3);
  assert.ok(rules.every((r) => !/lupe/i.test(r.text)));
});

test('canned asks and parseCannedChoice do not need an LLM', () => {
  const asks = cannedAsks({
    voice_rules: [{ id: 'no_tour', text: 'Do not open with a career tour.' }],
    bindings: [{ question_shape: 'why-us', tag: 'ops-platform' }],
    experience_updates: [],
  });
  assert.equal(asks[0].options.length, 4);
  assert.equal(parseCannedChoice('Keep what Magnet learned from this apply?\n→ Keep all'), 'all');
  assert.equal(parseCannedChoice('→ Keep voice rules only'), 'voice');
  assert.equal(parseCannedChoice('→ Keep story binding only'), 'binding');
  assert.equal(parseCannedChoice('→ Skip'), 'skip');
  assert.equal(parseCannedChoice('tell me more about the tour'), null);
});

test('keep-all writes a debrief voice version and a binding; skip writes nothing', async () => {
  reset();
  saveUserVoice('Be specific. No career tour.\n');
  const proposed = {
    voice_rules: [{ id: 'uneven', text: 'Do not force a tidy rule-of-three or parallel stack. Uneven length is correct.' }],
    bindings: [{ question_shape: 'why-us', tag: 'ops-platform' }],
    experience_updates: [],
  };
  const kept = await acceptLessons(proposed, 'all', { pairs: [rewrite], userText: 'Keep all' });
  assert.equal(kept.skipped, false);
  assert.equal(kept.voice.kind, 'debrief');
  assert.match(kept.voice.text, /Uneven length/);
  assert.equal(kept.bindings.length, 1);
  assert.equal(graph.bindingsFor('why-us')[0].tag, 'ops-platform');

  const before = graph.voiceHistory().length;
  const bindN = graph.bindingsFor('why-us').length;
  const skipped = await acceptLessons(proposed, 'skip');
  assert.equal(skipped.skipped, true);
  assert.equal(graph.voiceHistory().length, before);
  assert.equal(graph.bindingsFor('why-us').length, bindN);
  assert.match(formatAcceptReply(skipLessons(), 'skip'), /nothing saved/i);
});

test('saveDebriefVoice kind is debrief', () => {
  reset();
  saveUserVoice('Be specific.\n');
  const { row, wrote } = saveDebriefVoice([{ text: 'Prefer a short, specific answer over a long résumé-shaped paragraph.' }]);
  assert.equal(wrote, true);
  assert.equal(row.kind, 'debrief');
  assert.ok(graph.voiceHistory().some((h) => h.kind === 'debrief'));
});

test('runDebriefOpen with parsed payload skips the LLM', async () => {
  const out = await runDebriefOpen({
    pairs: [rewrite],
    parsed: {
      reply: 'Magnet opened with a career tour. You cut it to the auto-filler.',
      voice_rules: [{ text: 'Do not open with a career tour.' }],
      bindings: [{ question_shape: 'why-us', tag: 'ops-platform' }],
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.empty, false);
  assert.match(out.reply, /career tour/);
  assert.equal(out.asks.length, 1);
  assert.equal(out.proposed.voice_rules.length, 1);
});

test('open prompt asks for split lessons not a compact recap', () => {
  const prompt = buildDebriefOpenPrompt({
    voice: 'Be short.',
    pairs: [rewrite],
    company: 'Acme',
    context: { voice: 'Be short.', cards: [], bindings: [] },
  });
  assert.match(prompt, /voice_rules/);
  assert.match(prompt, /bindings/);
  assert.match(prompt, /No employer names/);
  assert.match(prompt, /source_card_ids/);
  assert.doesNotMatch(prompt, /Compact JSON/);
});

test('bindShippedMagnet writes shape bindings for unchanged Magnet essays', () => {
  const { bindShippedMagnet } = require('./voice-commit');
  reset();
  const card = graph.upsertCard({
    employer: 'Freelance',
    claim: 'Shipped an ops platform.',
    proof: 'Audit log.',
    tags: ['ops-platform'],
    confidence: 'corroborated',
    source: 'test',
  });
  const made = bindShippedMagnet([
    {
      origin: 'magnet',
      label: 'Why do you want this role?',
      source_card_ids: [card.card.id],
    },
    {
      origin: 'rewrite',
      label: 'Why this role',
      source_card_ids: [card.card.id],
    },
  ]);
  assert.equal(made.length, 1);
  assert.equal(graph.bindingsFor('why-us')[0].card_id, card.card.id);
  assert.equal(graph.bindingsFor('why-us')[0].source, 'complete-unchanged');
});

test('commitVoice no longer invokes silent compact', () => {
  const src = fs.readFileSync(path.join(__dirname, 'voice-commit.js'), 'utf8');
  assert.doesNotMatch(src, /voice-compact/);
  assert.match(src, /compileFinals/);
});
