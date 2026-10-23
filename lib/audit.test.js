const { test } = require('node:test');
const assert = require('node:assert/strict');
const { valuesEqual, residualReason, auditFields, looksContaminated } = require('./audit');

test('family conflict No is not Immediate family on the page', () => {
  const field = {
    label: 'Family / SO employed by Flock?',
    type: 'radio',
    options: ['Immediate family member', 'No relationship to current employees', 'Spouse / partner'],
  };
  assert.equal(valuesEqual('No', 'Immediate family member', field), false);
  assert.equal(valuesEqual('No', 'No relationship to current employees', field), true);
});

test('Yes matches long remote option', () => {
  assert.equal(valuesEqual('Yes', 'Yes, I intend to work remotely.'), true);
});

test('Yes matches long disability option', () => {
  assert.equal(valuesEqual('Yes', 'Yes, I have a disability, or have had one in the past'), true);
});

test('veteran aliases match', () => {
  assert.equal(valuesEqual('Not a Veteran', 'I am not a protected veteran'), true);
});

test('gender mismatch stays unequal', () => {
  assert.equal(valuesEqual('Non-binary', 'Decline To Self Identify'), false);
});

test('placeholder current is never equal', () => {
  assert.equal(valuesEqual('United States', 'Select...'), false);
});

test('skipped N/A follow-up is not leftover', () => {
  assert.equal(valuesEqual('N/A', 'N/A'), true);
  assert.equal(
    residualReason({
      route: 'static',
      label: 'If yes, referrer name',
      intended: 'N/A',
      current: 'N/A',
    }),
    null
  );
});

test('optional Twitter is not residual', () => {
  const { residualReason } = require('./audit');
  assert.equal(
    residualReason({
      route: 'static',
      label: 'Twitter',
      intended: '',
      current: '',
      magnetState: 'red',
    }),
    null
  );
  assert.equal(
    residualReason({
      route: 'static',
      label: 'Additional links (optional)',
      intended: '',
      current: '',
      magnetState: 'red',
    }),
    null
  );
});

test('checkbox Yes matches the consent label current only when checked', () => {
  assert.equal(
    valuesEqual('Yes', 'By checking this box, I consent to Reddit collecting data', {
      type: 'checkbox',
      checked: true,
    }),
    true
  );
  assert.equal(
    valuesEqual('Yes', 'By checking this box, I consent to Reddit collecting data', {
      type: 'checkbox',
      checked: false,
    }),
    false
  );
});

test('option list: picked Bachelor\'s is close enough to B.S.', () => {
  const field = {
    options: ["Bachelor's Degree", "Master's Degree", 'High School'],
  };
  assert.equal(valuesEqual('B.S. Computer Science', "Bachelor's Degree", field), true);
});

test('option list: US display matches United States intended', () => {
  const field = {
    options: ['United States', 'Canada', 'United Kingdom'],
    label: 'Country',
  };
  assert.equal(valuesEqual('United States', 'US', field), true);
  assert.equal(valuesEqual('US', 'United States', field), true);
});

test('red paint is not residual when current matches intended', () => {
  const reason = residualReason({
    route: 'static',
    intended: 'Yes',
    current: 'Yes, I intend to work remotely.',
    magnetState: 'red',
  });
  assert.equal(reason, null);
});

test('red + empty current is still residual', () => {
  const reason = residualReason({
    route: 'static',
    intended: 'US',
    current: '',
    magnetState: 'red',
  });
  assert.equal(reason, 'red');
});

test('auditFields drops Unsure on a green landed field', () => {
  const audit = auditFields([
    {
      id: 'm2',
      route: 'static',
      intended: 'United States',
      current: 'United States',
      magnetState: 'green',
      fill: { ok: true },
      uncertainty: { reason: 'Picked "United States" as closest to "US".', confidence: 'fuzzy' },
    },
  ]);
  assert.equal(audit.fields[0].uncertainty, null);
});

test('starred empty field is required_empty, not clean', () => {
  assert.equal(
    residualReason({
      route: 'static',
      label: 'Please select up to 2 ethnicities that you most closely identify with.*',
      current: '',
      required: false,
    }),
    'required_empty'
  );
  assert.equal(
    residualReason({
      route: 'static',
      label: 'What sexual orientation do you most closely identify with? *',
      current: 'Select...',
    }),
    'required_empty'
  );
  assert.equal(
    residualReason({
      route: 'static',
      label: 'Current company',
      current: '',
    }),
    null
  );
});

test('auditFields drops Unsure when values are close enough', () => {
  const audit = auditFields([
    {
      id: 'm1',
      route: 'static',
      intended: 'Yes',
      current: 'Yes, I intend to work remotely.',
      magnetState: 'green',
      fill: { ok: true },
      uncertainty: { reason: 'Picked a longer Yes.' },
    },
  ]);
  assert.equal(audit.residual_count, 0);
  assert.equal(audit.fields[0].uncertainty, null);
  assert.equal(audit.fields[0].ok, true);
});

test('phone digits on LinkedIn and dial-code gender are residuals', () => {
  assert.equal(
    looksContaminated({
      label: 'LinkedIn Profile',
      current: '5550100199',
    }),
    true
  );
  assert.equal(
    residualReason({
      route: 'static',
      label: 'LinkedIn Profile',
      intended: '5550100199',
      current: '5550100199',
    }),
    'intended_neq_current'
  );
  assert.equal(
    residualReason({
      route: 'static',
      label: 'What gender identity do you most closely identify with?',
      intended: 'Cayman Islands+1',
      current: 'Cayman Islands+1',
    }),
    'intended_neq_current'
  );
});

test('closed choice miss stays a needs-infer residual', () => {
  assert.equal(
    residualReason({
      route: 'static',
      label: 'Where are you based relative to our hubs?',
      type: 'checkbox',
      options: ['Atlanta, GA', 'Boston, MA'],
      intended: '',
      current: '',
      reason: 'needs-infer',
      magnetState: 'red',
    }),
    'needs-infer'
  );
});
