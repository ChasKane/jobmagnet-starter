const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retrieveKnowledge } = require('./knowledge-retrieve');
const { skillYearsCard } = require('./compile');

test('skill years card carries honesty bounds from the profile table', () => {
  const card = skillYearsCard({
    skills: {
      javascript: { years: 8 },
      vue: { years: 0 },
      angular: { years: 1 },
    },
  });
  assert.equal(card.id, 'card_skill_years');
  assert.match(card.honesty_bound, /vue/i);
  assert.match(card.proof, /javascript: 8/);
  assert.doesNotMatch(card.claim, /Lupe|Peloton|high school/i);
});

test('retrieve includes skill years and does not invent a biography', () => {
  const text = retrieveKnowledge('how many years of Vue');
  assert.match(text, /### Skill years/);
  assert.doesNotMatch(text, /Lupe|Peloton|high school|Do not inflate past 8/i);
});
