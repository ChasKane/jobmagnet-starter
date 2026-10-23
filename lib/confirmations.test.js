const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const facts = require('./profile-facts');
const { confirmClass, contradictClass, getConfirmation, invalidate } = require('./confirmations');

function withTempProfile(body, fn) {
  const prev = process.env.MAGNET_PROFILE;
  const file = path.join(os.tmpdir(), `magnet-profile-${process.pid}-${Date.now()}.yaml`);
  fs.writeFileSync(file, body);
  process.env.MAGNET_PROFILE = file;
  facts.invalidate();
  invalidate();
  try {
    return fn(file);
  } finally {
    if (prev == null) delete process.env.MAGNET_PROFILE;
    else process.env.MAGNET_PROFILE = prev;
    facts.invalidate();
    invalidate();
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
}

test('years confirm writes skills, not a leftover answers row', () => {
  withTempProfile('identity:\n  first_name: Alex\n', () => {
    confirmClass('years:vue', '0', { source: 'accept' });
    const doc = facts.load();
    assert.equal(doc.skills.vue.years, 0);
    assert.equal(doc.answers, undefined);
    const row = getConfirmation('years:vue');
    assert.equal(row.value, '0');
    assert.equal(row.source, 'profile');
  });
});

test('other first name writes identity and reads back from profile', () => {
  withTempProfile('identity:\n  first_name: Alex\n', () => {
    confirmClass('other:first name', 'Alex', { source: 'harvest' });
    const doc = facts.load();
    assert.equal(doc.identity.first_name, 'Alex');
    assert.equal(doc.answers, undefined);
    assert.equal(getConfirmation('other:first name').value, 'Alex');
  });
});

test('consent confirm writes the work fact, not answers', () => {
  withTempProfile('work:\n  remote: true\n', () => {
    confirmClass('consent:recording', 'Yes', { source: 'accept', label: 'Candidate Consent' });
    const doc = facts.load();
    assert.equal(doc.work.interview_recording_consent, true);
    assert.equal(doc.answers, undefined);
    assert.equal(getConfirmation('consent:recording').value, 'Yes');
    assert.equal(getConfirmation('consent:recording').source, 'profile');
  });
});

test('other leftover confirm keeps identity and skills', () => {
  withTempProfile('identity:\n  first_name: Alex\nskills:\n  javascript:\n    years: 8\n', (file) => {
    confirmClass('other:additional skills', 'Comptia A+', { source: 'harvest', label: 'Additional Skills' });
    const raw = fs.readFileSync(file, 'utf8');
    assert.match(raw, /first_name: Alex/);
    assert.match(raw, /javascript:/);
    const doc = facts.load();
    assert.equal(doc.identity.first_name, 'Alex');
    assert.equal(doc.skills.javascript.years, 8);
    assert.equal(doc.answers.other_additional_skills.value, 'Comptia A+');
  });
});

test('orientation confirm writes eeo.orientation', () => {
  withTempProfile('identity:\n  first_name: Alex\n', () => {
    confirmClass('eeo:orientation', 'queer', { source: 'accept', label: 'Sexual orientation' });
    const doc = facts.load();
    assert.equal(doc.eeo.orientation, 'queer');
    assert.equal(doc.answers, undefined);
    assert.equal(getConfirmation('eeo:orientation').value, 'queer');
  });
});

test('harvest of a different phone does not overwrite identity.phone', () => {
  withTempProfile('identity:\n  phone: "+1 555-010-0199"\n  phone_national: "5550100199"\n', () => {
    const row = confirmClass('identity:phone', '1-206-605-4884', { source: 'harvest', label: 'Phone' });
    assert.equal(row, null);
    const doc = facts.load();
    assert.equal(doc.identity.phone, '+1 555-010-0199');
    assert.equal(doc.identity.phone_national, '5550100199');
  });
});

test('contradict overlays a profile fact without deleting it', () => {
  withTempProfile('skills:\n  vue:\n    years: 0\n', () => {
    contradictClass('years:vue', { source: 'wrong_value' });
    assert.equal(facts.load().skills.vue.years, 0);
    assert.equal(getConfirmation('years:vue').confidence, 'contradicted');
  });
});
