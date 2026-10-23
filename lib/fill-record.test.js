const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileRecordedEvents, pickDecoy, skipDecoy, preferWidgetSelector, formatStep } = require('./fill-record');

test('compile collapses typeahead into click, type, clickOption', () => {
  const steps = compileRecordedEvents([
    { t: 1000, kind: 'click', selector: 'div.select__control' },
    { t: 1040, kind: 'input', value: 'L' },
    { t: 1080, kind: 'input', value: 'Li' },
    { t: 1300, kind: 'option', text: 'LinkedIn' },
  ]);
  assert.deepEqual(
    steps.map((s) => s.op),
    ['click', 'type', 'wait', 'clickOption']
  );
  assert.equal(steps[0].selector, '.select__control');
});

test('compile drops ephemeral selectors and duplicate types', () => {
  const steps = compileRecordedEvents([
    { t: 1, kind: 'click', selector: '[data-magnet-field="mabc123"]' },
    { t: 2, kind: 'input' },
    { t: 3, kind: 'input' },
    { t: 4, kind: 'key', key: 'Enter' },
  ]);
  assert.equal(steps[0].op, 'click');
  assert.equal(steps[0].selector, undefined);
  assert.equal(steps.filter((s) => s.op === 'type').length, 1);
  assert.equal(steps.some((s) => s.op === 'clickOption'), true);
});

test('preferWidgetSelector maps react-select paths', () => {
  assert.equal(preferWidgetSelector('div > div.select__control'), '.select__control');
  assert.equal(preferWidgetSelector('#mab12cd'), '');
});

test('formatStep is what the card lists', () => {
  assert.equal(formatStep({ op: 'click', selector: '.select__control' }), 'click .select__control');
  assert.equal(formatStep({ op: 'clickOption' }), 'click option');
  assert.equal(formatStep({ op: 'wait', ms: 200 }), 'wait 200ms');
});

test('pickDecoy uses another real option, not a fake string', () => {
  const field = {
    label: 'How did you hear about us?',
    options: ['Select...', 'LinkedIn', 'Indeed', 'Other'],
  };
  assert.equal(pickDecoy(field, 'LinkedIn'), 'Indeed');
});

test('skip decoy on consent, EEO, and country cascade', () => {
  assert.equal(skipDecoy({ label: 'Candidate Consent Acknowledgment' }), true);
  assert.equal(pickDecoy({ label: 'Gender', options: ['Male', 'Female'] }, 'Male'), null);
  assert.equal(pickDecoy({ label: 'Country', options: ['United States', 'Canada'] }, 'United States'), null);
  assert.equal(pickDecoy({ label: 'State', options: ['Florida', 'Washington'] }, 'Washington'), null);
});

test('radio clicks compile to clickOption, not labeled-radio-N', () => {
  const steps = compileRecordedEvents([
    { t: 1, kind: 'click', selector: '#_r_abc-labeled-radio-1' },
  ]);
  assert.deepEqual(steps, [{ op: 'clickOption' }]);
});

test('skip decoy on family-conflict radios', () => {
  const field = {
    label: 'Family / SO employed by Flock?',
    type: 'radio',
    options: ['Immediate family member', 'No relationship to current employees', 'Spouse / partner'],
  };
  assert.equal(skipDecoy(field), true);
  assert.equal(pickDecoy(field, 'No'), null);
});

test('years leftover can use another option as decoy', () => {
  const field = {
    label: 'Years of Vue experience',
    options: ['0', '1', '2', '3+'],
  };
  assert.equal(pickDecoy(field, '0'), '1');
  assert.equal(skipDecoy(field), false);
});
