const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  reviewControl,
  reviewOptionLabels,
  matchReviewOption,
  selectedReviewChoices,
  withCurrentOption,
  placeholderOption,
} = require('./review-control');

test('native select uses a select with real options, dropping placeholders', () => {
  const spec = reviewControl({
    type: 'select-one',
    tag: 'select',
    select: true,
    options: ['Select...', 'Yes', 'No', 'Prefer not to say'],
  });
  assert.equal(spec.kind, 'select');
  assert.deepEqual(spec.options, ['Yes', 'No', 'Prefer not to say']);
  assert.equal(placeholderOption('Select...'), true);
});

test('react-select / combobox with scraped options is still a select', () => {
  assert.equal(
    reviewControl({ type: 'combobox', reactSelect: true, options: ['LinkedIn', 'Indeed', 'Other'] }).kind,
    'select'
  );
  assert.equal(
    reviewControl({ type: 'text', shape: { family: 'native_select' }, options: ['FL', 'WA'] }).kind,
    'select'
  );
});

test('radio / yes-no choice groups render radios, not a text box', () => {
  assert.equal(reviewControl({ type: 'radio', options: ['Yes', 'No'] }).kind, 'radios');
  assert.equal(
    reviewControl({ type: 'text', shape: { family: 'choice_group' }, options: ['Yes', 'No'] }).kind,
    'radios'
  );
});

test('long radio lists collapse to a select', () => {
  const options = Array.from({ length: 12 }, (_, i) => 'Option ' + i);
  assert.equal(reviewControl({ type: 'radio', options }).kind, 'select');
});

test('checkbox groups and lone consent boxes match their widgets', () => {
  assert.equal(reviewControl({ type: 'checkbox', options: ['Email', 'SMS', 'Phone'] }).kind, 'checkboxes');
  assert.equal(reviewControl({ type: 'checkbox', options: ['I agree'] }).kind, 'checkbox');
  assert.equal(reviewControl({ type: 'checkbox', options: [] }).kind, 'checkbox');
});

test('hubs leftover is a multi-checkbox card', () => {
  const spec = reviewControl({
    label: 'Where are you based relative to our hubs?',
    type: 'checkbox',
    options: ['Atlanta, GA', 'Boston, MA', 'London, UK', 'Nairobi, Kenya'],
  });
  assert.equal(spec.kind, 'checkboxes');
  assert.deepEqual(spec.options, ['Atlanta, GA', 'Boston, MA', 'London, UK', 'Nairobi, Kenya']);
});

test('open fields keep a typed control', () => {
  assert.equal(reviewControl({ type: 'text', tag: 'input' }).kind, 'text');
  assert.equal(reviewControl({ type: 'email' }).kind, 'email');
  assert.equal(reviewControl({ type: 'tel' }).kind, 'tel');
  assert.equal(reviewControl({ tag: 'textarea' }).kind, 'textarea');
  assert.equal(reviewControl({ type: 'file' }).kind, 'file');
});

test('select without scraped options falls back to text, not an empty dropdown', () => {
  assert.equal(reviewControl({ tag: 'select', select: true, options: [] }).kind, 'text');
});

test('orientation react-select with page options is a dropdown', () => {
  const spec = reviewControl({
    label: 'What sexual orientation do you most closely identify with? *',
    type: 'combobox',
    reactSelect: true,
    options: ['Heterosexual or Straight', 'Gay or Lesbian', 'Bisexual', 'Queer', 'I do not wish to answer'],
  });
  assert.equal(spec.kind, 'select');
  assert.deepEqual(spec.options, [
    'Heterosexual or Straight',
    'Gay or Lesbian',
    'Bisexual',
    'Queer',
    'I do not wish to answer',
  ]);
});

test('option matching is case-insensitive and keeps unknown current values', () => {
  assert.equal(matchReviewOption(['Yes', 'No'], 'yes'), 'Yes');
  assert.deepEqual(reviewOptionLabels({ options: [{ text: 'Yes' }, { label: 'No' }, 'Select'] }), ['Yes', 'No']);
  assert.deepEqual(selectedReviewChoices(['Email', 'SMS'], 'Email, SMS'), ['Email', 'SMS']);
  assert.deepEqual(withCurrentOption(['Yes', 'No'], 'Maybe'), ['Maybe', 'Yes', 'No']);
});
