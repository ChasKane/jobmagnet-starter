const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyField } = require('./classify');

test('Ramp exceptional-performance open text is an essay, not a leftover', () => {
  const field = {
    label:
      'We believe exceptional performance in one area is a good indication of performance in other areas. Do you have any examples of exceptional performance you want to highlight?',
    type: 'text',
    tag: 'input',
    options: [],
  };
  assert.equal(classifyField(field).route, 'needs_llm');
});

test('Please describe JS/React is an essay', () => {
  const field = {
    label: 'Do you have proficiency in JavaScript and React? Please describe.',
    type: 'textarea',
    tag: 'textarea',
  };
  assert.equal(classifyField(field).route, 'needs_llm');
});

test('proud-of project prompt is an essay even without a question mark', () => {
  const field = {
    label: 'Please share one project or system you’ve worked on that you’re most proud of (professional or personal).',
    type: 'text',
    tag: 'input',
    options: [],
  };
  assert.equal(classifyField(field).route, 'needs_llm');
});

test('yes/no production-experience checkbox stays static', () => {
  const field = {
    label: 'Have you built and deployed production-level applications using React, TypeScript (or JavaScript), and other modern front-end technologies?',
    type: 'checkbox',
    options: ['on'],
  };
  assert.equal(classifyField(field).route, 'static');
});

test('Ashby appData dump is skipped', () => {
  const field = {
    label: 'window.__appData = {"ddRumApplicationId":"80e0bf43-e772-45ac-858b-1e6dc0f1f415"',
    type: 'text',
  };
  assert.equal(classifyField(field).route, 'skip');
});

test('years-of-experience textarea is static, not an essay', () => {
  const field = {
    label: 'How many years of experience do you have with JavaScript?',
    type: 'textarea',
    tag: 'textarea',
  };
  assert.equal(classifyField(field).route, 'static');
  assert.equal(classifyField({ ...field, label: 'How many years of Svelte experience do you have?' }).route, 'static');
});

test('salary textarea is static', () => {
  const field = {
    label: 'What are your salary expectations?',
    type: 'textarea',
    tag: 'textarea',
  };
  assert.equal(classifyField(field).route, 'static');
});

test('have-you-used LOIS textarea is static', () => {
  const field = {
    label: "Have you used Filevine's LOIS?",
    type: 'textarea',
    tag: 'textarea',
  };
  assert.equal(classifyField(field).route, 'static');
});

test('short job-title question stays static', () => {
  const field = {
    label: 'What is your current or previous job title?',
    type: 'text',
    tag: 'input',
  };
  assert.equal(classifyField(field).route, 'static');
});
