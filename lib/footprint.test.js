const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { footprint, lookupFootprint, rememberFootprint } = require('./footprint');
const { optionSetKind, pickClosestOption } = require('./option-match');

const disability = [
  'Yes, I have a disability, or have had one in the past',
  'No, I do not have a disability, or have not had one in the past',
];

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), 'footprints.yaml');
}

test('the same EEO options share a footprint when the prompt wording drifts', () => {
  const a = footprint('Do you have a disability?', disability);
  const b = footprint('Disability status', disability);
  assert.equal(a.id, b.id);
  assert.equal(a.kind, 'eeo');
});

test('yes/no questions stay distinct, and a state list is named', () => {
  const sponsor = footprint('Will you now or in the future require sponsorship?', ['Yes', 'No']);
  const veteran = footprint('Are you a protected veteran?', ['Yes', 'No']);
  assert.notEqual(sponsor.id, veteran.id);
  assert.equal(optionSetKind(['Illinois', 'Indiana', 'Iowa']), 'named');
  const pick = pickClosestOption(['Illinois', 'Indiana', 'Iowa'], 'No', [], 'State');
  assert.equal(pick.option, null);
});

test('a taught answer is reused and a profile answer does not replace it', () => {
  const file = tempFile();
  rememberFootprint('Do you have a disability?', disability, disability[1], 'profile', file);
  const taught = rememberFootprint('Disability status', disability, disability[0], 'taught', file);
  assert.equal(taught.source, 'taught');
  assert.match(taught.answer, /^Yes/);
  const kept = rememberFootprint('Disability', disability, disability[1], 'profile', file);
  assert.equal(kept.source, 'taught');
  assert.match(lookupFootprint('Please select disability', disability, file).answer, /^Yes/);
});
