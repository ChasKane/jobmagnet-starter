const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.MAGNET_PROFILE = path.join(__dirname, 'fixtures', 'skill-table.yaml');
const { matchSkill, extractNamedStack, yearsAnswer } = require('./profile-skills');
require('./profile-facts').invalidate();
require('./question-catalog').invalidate();
const {
  yesNoAnswer,
  isClosedFactPrompt,
  isYearsCountPrompt,
  isOpenEssayPrompt,
} = require('./question-catalog');

test('extractNamedStack reads with-X and years-of-X', () => {
  assert.equal(extractNamedStack('How many years of hand-on experience do you have with AngularJs?'), 'angular');
  assert.equal(extractNamedStack('Years of Vue experience'), 'vue');
  assert.equal(extractNamedStack('How many years of hands-on experience do you have?'), '');
});

test('known stacks resolve to the profile table', () => {
  assert.equal(matchSkill('How many years of TypeScript experience do you have?').id, 'typescript');
  assert.equal(yearsAnswer('How many years of experience do you have with JavaScript?'), '8');
  assert.equal(yearsAnswer('How many years of React.js experience do you have?'), '8');
  assert.equal(yearsAnswer('How many years of Svelte experience do you have?'), '0');
  assert.equal(yearsAnswer('How many years of Vue.js experience do you have?'), '0');
  assert.equal(yearsAnswer('How many years of hands-on Svelte experience do you have?'), '0');
  assert.equal(yearsAnswer('How many years of SvelteKit experience do you have?'), '0');
  assert.equal(yearsAnswer('How many years of experience do you have with Next.js?'), '2');
  assert.equal(yearsAnswer('How many years writing production code?'), '8');
  assert.equal(yearsAnswer('How many years of hand-on experience do you have in coding?'), '12');
  assert.equal(yearsAnswer('How many years of hands-on experience do you have?'), '12');
});

test('React Native is not the React skill', () => {
  assert.equal(matchSkill('Do you have production experience with React Native?').years, null);
  assert.equal(yearsAnswer('Do you have production experience with React Native?'), null);
});

test('unknown years questions stay empty instead of inventing zero', () => {
  assert.equal(yearsAnswer('How many years of Solid experience do you have?'), null);
  assert.equal(yearsAnswer('How many years of hands-on experience do you have with Solid?'), null);
});

test('named Filevine stacks do not fall through to coding years', () => {
  assert.equal(yearsAnswer('How many years of Angular experience do you have?'), '1');
  assert.equal(yearsAnswer('How many years of hand-on experience do you have with AngularJs?'), '1');
  assert.equal(yearsAnswer('How many years of hand-on experience do you have with VueJs?'), '0');
});

test('describe prompts stay essays', () => {
  const label = 'Do you have proficiency in JavaScript and React? Please describe.';
  assert.equal(isOpenEssayPrompt(label), true);
  assert.equal(isYearsCountPrompt(label), false);
  assert.equal(isClosedFactPrompt(label), false);
});

test('threshold and product yes/no use the profile table', () => {
  assert.equal(yesNoAnswer('Do you have at least 3 years of React experience?'), 'Yes');
  assert.equal(yesNoAnswer('Do you have at least 3 years of Svelte experience?'), 'No');
  assert.equal(yesNoAnswer("Have you used Filevine's LOIS?"), 'No');
});
