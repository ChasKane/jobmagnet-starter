const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVoiceLearnPrompt, parseVoiceLearnJson, wantLlmVoice } = require('./voice-learn');

test('voice learn prompt asks for rules from diffs, not a phrase list', () => {
  const prompt = buildVoiceLearnPrompt({
    voice: 'Be short.',
    pairs: [{ label: 'Why us', llm_draft: 'I built Job Magnet.', final: 'I already do this with an auto-filler.' }],
  });
  assert.match(prompt, /Draft:/);
  assert.match(prompt, /Final:/);
  assert.match(prompt, /No employer names/);
  assert.doesNotMatch(prompt, /career tour\|three employer/);
});

test('parseVoiceLearnJson drops empty rules', () => {
  const { rules } = parseVoiceLearnJson('{"rules":[{"id":"describe-tools","text":"Describe the tool; do not name it."},{"id":"x","text":""}]}');
  assert.equal(rules.length, 1);
  assert.match(rules[0].text, /Describe the tool/);
});

test('tests do not call the voice LLM', () => {
  assert.equal(wantLlmVoice({}), false);
});
