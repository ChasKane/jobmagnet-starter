const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.MAGNET_PROFILE = path.join(__dirname, 'fixtures', 'skill-table.yaml');
const { classifyQuestion, confirmedOrFactValue } = require('./question-class');
const { confirmClass, invalidate } = require('./confirmations');
const facts = require('./profile-facts');

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

test('year prompts classify by stack, not exact wording', () => {
  const a = classifyQuestion({ label: 'How many years of hand-on experience do you have with VueJs?' });
  const b = classifyQuestion({ label: 'Years of Vue experience' });
  assert.equal(a.class, 'years:vue');
  assert.equal(b.class, 'years:vue');
  assert.equal(a.factValue, '0');
});

test('angular years are on file after Filevine accept', () => {
  const q = classifyQuestion({ label: 'How many years of hand-on experience do you have with AngularJs?' });
  assert.equal(q.class, 'years:angular');
  assert.equal(q.factValue, '1');
});

test('generic hands-on without a stack is coding, not a named invent', () => {
  const q = classifyQuestion({ label: 'How many years of hands-on experience do you have?' });
  assert.equal(q.class, 'years:coding');
  assert.equal(q.factValue, '12');
});

test('consent is a yes/no fact, default Yes', () => {
  const q = classifyQuestion({ label: 'Candidate Consent Acknowledgment' });
  assert.equal(q.kind, 'consent');
  assert.equal(q.class, 'consent:recording');
  assert.equal(q.factValue, 'Yes');
});

test('checkbox I consent language is the same consent fact', () => {
  const q = classifyQuestion({
    label: 'By checking this box, I consent to Reddit collecting, storing, and processing my responses.',
  });
  assert.equal(q.kind, 'consent');
  assert.equal(q.factValue, 'Yes');
});

test('orientation wordings are one eeo class', () => {
  assert.equal(
    classifyQuestion({ label: 'What sexual orientation do you most closely identify with?' }).class,
    'eeo:orientation'
  );
  assert.equal(classifyQuestion({ label: 'How would you describe your sexual orientation?' }).class, 'eeo:orientation');
});

test('salary and work-auth have profile facts', () => {
  assert.equal(classifyQuestion({ label: 'What are your base salary expectations?' }).class, 'salary:base');
  assert.equal(classifyQuestion({ label: 'Are you legally authorized to work in the United States?' }).class, 'work_auth:us');
  assert.equal(
    classifyQuestion({ label: 'Will you now or in the future require sponsorship?' }).class,
    'sponsorship'
  );
});

test('phone-number country confirmation is ignored', () => {
  withTempProfile('identity:\n  first_name: Alex\n  phone_national: "5550100199"\n', () => {
    confirmClass('identity:country', '5550100199', { source: 'review', label: 'Phone' });
    const got = confirmedOrFactValue({ label: 'Country', type: 'select', options: ['Canada', 'United States'] });
    assert.notEqual(got.value, '5550100199');
    assert.equal(got.value, 'United States');
  });
});

test('confirmed hub option is the fact, not based_city', () => {
  withTempProfile('identity:\n  based_city: Seattle\n', () => {
    confirmClass('location:hubs', 'Atlanta, GA', {
      source: 'review',
      label: 'Where are you based relative to our hubs?',
    });
    const got = confirmedOrFactValue({
      label: 'Where are you based relative to our hubs?',
      type: 'checkbox',
      options: ['Atlanta, GA', 'Boston, MA'],
    });
    assert.equal(got.q.class, 'location:hubs');
    assert.equal(got.value, 'Atlanta, GA');
  });
});
