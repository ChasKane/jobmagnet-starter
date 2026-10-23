const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isInstructionLabel,
  isQuestionLike,
  isHeadingQuestion,
  isSectionChrome,
  pairCascade,
} = require('./question-cascade');

test('instruction lines are not questions', () => {
  assert.equal(isInstructionLabel('Select one of the following'), true);
  assert.equal(isInstructionLabel('Please check all that apply:'), true);
  assert.equal(isInstructionLabel('Choose all that apply'), true);
  assert.equal(isQuestionLike('Select one of the following'), false);
  assert.equal(isQuestionLike('How did you hear about Hive?'), true);
  assert.equal(isSectionChrome('Additional Questions'), true);
  assert.equal(isQuestionLike('Additional Questions'), false);
});

test('preceding question owns the next checkbox cluster', () => {
  const map = pairCascade([
    { kind: 'question', text: 'How did you hear about Hive?' },
    { kind: 'instruction', text: 'Select one of the following' },
    { kind: 'control', id: 'a', cluster: 'hear' },
    { kind: 'control', id: 'b', cluster: 'hear' },
    { kind: 'question', text: 'If Other, please specify' },
    { kind: 'control', id: 'c', cluster: 'other' },
  ]);
  assert.equal(map.a, 'How did you hear about Hive?');
  assert.equal(map.b, 'How did you hear about Hive?');
  assert.equal(map.c, 'If Other, please specify');
});

test('a consumed question does not leak onto the next cluster', () => {
  const map = pairCascade([
    { kind: 'question', text: 'How did you hear about us?' },
    { kind: 'control', id: 'a', cluster: 'hear' },
    { kind: 'control', id: 'b', cluster: 'eeo' },
  ]);
  assert.equal(map.a, 'How did you hear about us?');
  assert.equal(map.b, undefined);
});

test('instruction-only chrome never becomes the question text', () => {
  const map = pairCascade([
    { kind: 'instruction', text: 'Select one of the following' },
    { kind: 'control', id: 'a', cluster: 'hear' },
  ]);
  assert.equal(map.a, undefined);
});

test('catalog aliases count as questions without a question mark', () => {
  assert.equal(isQuestionLike('Candidate Consent Acknowledgment'), true);
  assert.equal(isQuestionLike('visa sponsorship'), true);
  assert.equal(isQuestionLike('Select one of the following'), false);
});

test('JD compensation headings are not questions; field titles still are', () => {
  assert.equal(isHeadingQuestion('Compensation'), false);
  assert.equal(isHeadingQuestion('The base salary range for this position is:'), false);
  assert.equal(isQuestionLike('Compensation'), true);
  assert.equal(isQuestionLike('What are your compensation expectations?'), true);
  assert.equal(isHeadingQuestion('What are your compensation expectations?'), true);
  assert.equal(isQuestionLike('Name'), false);
});

test('ethnicity prompt is a question, not instruction chrome', () => {
  const prompt = 'Please select up to 2 ethnicities that you most closely identify with?';
  assert.equal(isInstructionLabel(prompt), false);
  assert.equal(isQuestionLike(prompt), true);
  assert.equal(isSectionChrome('Reddit U.S. Equal Employment Information'), true);
  assert.equal(isQuestionLike('Reddit U.S. Equal Employment Information'), false);
});