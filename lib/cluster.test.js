const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isInstructionLabel } = require('./question-cascade');
const {
  mergeInventoryClusters,
  preferredQuestion,
  shapeFromField,
  optionHash,
  clusterDedupeKey,
  shapeDistance,
} = require('./cluster');

test('instruction chrome is not the question', () => {
  assert.equal(isInstructionLabel('Select one of the following'), true);
  assert.equal(preferredQuestion('Select one of the following', 'How did you hear about Hive?'), 'How did you hear about Hive?');
  assert.equal(preferredQuestion('Please check all that apply:', ''), '');
  assert.equal(preferredQuestion('How did you hear about Hive?', ''), 'How did you hear about Hive?');
});

test('radio group with the same clusterId becomes one row', () => {
  const rows = mergeInventoryClusters([
    {
      id: 'a',
      clusterId: 'n:hear',
      type: 'checkbox',
      tag: 'input',
      name: 'hear[]',
      label: 'LinkedIn',
      options: ['LinkedIn'],
    },
    {
      id: 'b',
      clusterId: 'n:hear',
      type: 'checkbox',
      tag: 'input',
      name: 'hear[]',
      label: 'Indeed',
      options: ['Indeed'],
    },
    {
      id: 'c',
      clusterId: 'n:hear',
      type: 'checkbox',
      tag: 'input',
      name: 'hear[]',
      label: 'Select one of the following',
      heading: 'How did you hear about Hive?',
      options: ['Glassdoor'],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'How did you hear about Hive?');
  assert.deepEqual(rows[0].options.sort(), ['Glassdoor', 'Indeed', 'LinkedIn'].sort());
  assert.equal(rows[0].controls.length, 3);
  assert.equal(rows[0].shape.family, 'choice_group');
  assert.match(rows[0].shape.optionHash, /linkedin/);
});

test('hear-about question plus instruction plus boards is one cluster', () => {
  const row = mergeInventoryClusters([
    {
      id: 'p',
      clusterId: 'b:hear',
      type: 'checkbox',
      heading: 'How did you hear about us?',
      label: 'Select one of the following',
      options: ['LinkedIn', 'Indeed', 'Glassdoor', 'Recruiter'],
      controls: [
        { id: 'p', tag: 'input', type: 'checkbox', name: 'source' },
        { id: 'q', tag: 'input', type: 'checkbox', name: 'source' },
      ],
    },
  ])[0];
  assert.equal(row.label, 'How did you hear about us?');
  assert.equal(row.shape.family, 'choice_group');
  assert.equal(optionHash(row.options).includes('linkedin'), true);
});

test('unrelated text fields stay separate', () => {
  const rows = mergeInventoryClusters([
    { id: 'n', clusterId: 'id:first', type: 'text', tag: 'input', label: 'First Name' },
    { id: 'e', clusterId: 'id:email', type: 'email', tag: 'input', label: 'Email' },
  ]);
  assert.equal(rows.length, 2);
});

test('empty text shapes are far, not a shared how-to', () => {
  const a = { type: 'text', shape: { family: 'text', open: 'visible', bits: ['native_value'], optionHash: '', path: '' } };
  const b = { type: 'email', shape: { family: 'text', open: 'visible', bits: ['native_value'], optionHash: '', path: '' } };
  assert.equal(shapeDistance(a, b).rank, 'far');
});

test('generic form/input paths are not a shared text recipe', () => {
  const a = { type: 'text', shape: { family: 'text', bits: ['native_value'], optionHash: '', path: 'form>input.name' } };
  const b = { type: 'text', shape: { family: 'text', bits: ['native_value'], optionHash: '', path: 'body>form>input' } };
  assert.equal(shapeDistance(a, b).rank, 'far');
});

test('shape distance is exact for the same family and options, far across families', () => {
  const a = {
    type: 'radio',
    options: ['18-24', '25-34', '35-44'],
    shape: { family: 'choice_group', open: 'visible', bits: ['click-label'], path: 'fieldset>label' },
  };
  const b = {
    type: 'radio',
    options: ['18 – 24', '25-34', '35-44'],
    shape: { family: 'choice_group', open: 'visible', bits: ['click-label'], path: 'fieldset>div>label' },
  };
  const c = {
    reactSelect: true,
    options: [],
    shape: { family: 'react_select', open: 'click-typeahead', bits: ['listbox-on-open', 'typeahead', 'clickOption'], path: 'div.select__control' },
  };
  assert.equal(shapeFromField(a).optionHash, shapeFromField(b).optionHash);
  assert.equal(shapeDistance(a, b).rank === 'exact' || shapeDistance(a, b).rank === 'near', true);
  assert.equal(shapeDistance(a, c).rank, 'far');
});

test('cluster dedupe key prefers question text over clusterId', () => {
  assert.equal(
    clusterDedupeKey({ clusterId: 'n:hear', label: 'How did you hear about us?' }),
    'q:how did you hear about us'
  );
  assert.equal(
    clusterDedupeKey({
      clusterId: 'check:1',
      label: 'By checking this box, I consent to Reddit collecting my responses.',
    }),
    clusterDedupeKey({
      clusterId: 'id:m2',
      type: 'text',
      label: 'By checking this box, I consent to Reddit collecting my responses.',
    })
  );
  assert.equal(clusterDedupeKey({ label: 'Select one' }), '');
  assert.equal(preferredQuestion('Select...', 'Reddit U.S. Equal Employment Information'), '');
  assert.equal(preferredQuestion('Name', 'Compensation'), 'Name');
  assert.equal(
    preferredQuestion('First Name', 'The base salary range for this position is:'),
    'First Name'
  );
  assert.equal(
    clusterDedupeKey({
      label: 'Select...',
      heading: 'Reddit U.S. Equal Employment Information',
      reactSelect: true,
    }),
    ''
  );
});

test('shape distance weights optionHash and attrs over path', () => {
  const a = {
    type: 'radio',
    options: ['18-24', '25-34'],
    shape: {
      family: 'choice_group',
      open: 'visible',
      bits: ['click-label'],
      path: 'form>div.abc>div.xyz>label',
      attrs: ['age_range'],
    },
  };
  const b = {
    type: 'radio',
    options: ['18-24', '25-34'],
    shape: {
      family: 'choice_group',
      open: 'visible',
      bits: ['click-label'],
      path: 'form>section>div.other>fieldset>label',
      attrs: ['age_range'],
    },
  };
  const d = shapeDistance(a, b);
  assert.ok(d.rank === 'near' || d.rank === 'exact');
  assert.ok(d.score >= 0.7);
});
