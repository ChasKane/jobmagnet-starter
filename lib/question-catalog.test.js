const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classify, learnAlias, invalidate } = require('./question-catalog');
const { classifyField } = require('./classify');

test('Reddit demographic consent is a consent fact, not unlabeled', () => {
  const q = classify({
    label:
      'By checking this box, I consent to Reddit collecting, storing, and processing my responses to the demographic data surveys above.',
    type: 'checkbox',
  });
  assert.equal(q.kind, 'consent');
  assert.equal(q.class, 'consent:recording');
  assert.equal(q.factValue, 'Yes');
});

test('if you consent select Affirmative classifies as consent', () => {
  const q = classify({
    label: 'If you consent to the processing of your personal data, select Affirmative.',
    options: ['Affirmative', 'Decline'],
  });
  assert.equal(q.kind, 'consent');
  assert.equal(q.factValue, 'Yes');
});

test('SMS opt-in is not recording consent', () => {
  const q = classify({ label: 'Do you consent to receive SMS updates?', options: ['Yes', 'No'] });
  assert.notEqual(q.kind, 'consent');
});

test('country dropdown is a known mailing fact, not a missing fact', () => {
  const q = classify({
    label: 'Country',
    type: 'select',
    select: true,
    options: ['Afghanistan', 'American Samoa', 'Canada', 'United States of America', 'United Kingdom'],
  });
  assert.equal(q.class, 'identity:country');
  assert.equal(q.factValue, 'United States');
});

test('city and Workday country autocomplete stay mailing facts', () => {
  assert.equal(classify({ label: 'City', type: 'text' }).class, 'identity:city');
  assert.equal(classify({ label: 'City', type: 'text' }).factValue, null);
  assert.equal(
    classify({
      label: 'Please Select',
      type: 'select',
      options: ['Afghanistan', 'Canada', 'United Kingdom', 'United States of America', 'Germany'],
    }).class,
    'identity:country'
  );
});

test('option signature rescues hear-about when the label is chrome', () => {
  const q = classify({
    label: 'Select one of the following',
    options: ['LinkedIn', 'Indeed', 'Glassdoor', 'Recruiter'],
  });
  assert.equal(q.class, 'hear_about');
  assert.equal(q.factValue, 'LinkedIn');
});

test('age buckets rescue an unlabeled cluster', () => {
  const q = classify({
    label: '',
    options: ['18-24', '25-34', '35-44'],
  });
  assert.equal(q.class, 'age:range');
});

test('years textarea stays static, cover letter input is an essay', () => {
  assert.equal(
    classifyField({
      label: 'How many years of experience do you have with JavaScript?',
      type: 'textarea',
      tag: 'textarea',
    }).route,
    'static'
  );
  assert.equal(
    classifyField({
      label: 'Please share one project or system you’ve worked on that you’re most proud of (professional or personal).',
      type: 'text',
      tag: 'input',
      options: [],
    }).route,
    'needs_llm'
  );
  assert.equal(
    classifyField({
      label: 'Work experience',
      type: 'textarea',
      tag: 'textarea',
    }).route,
    'needs_llm'
  );
});

test('orientation wordings share eeo:orientation', () => {
  assert.equal(
    classify({ label: 'What sexual orientation do you most closely identify with?' }).class,
    'eeo:orientation'
  );
  assert.equal(
    classify({ label: 'How would you describe your sexual orientation?' }).class,
    'eeo:orientation'
  );
  assert.equal(classify({ label: 'LGBTQ identity' }).class, 'eeo:orientation');
});

test('straight gay bi queer options rescue orientation without the phrase', () => {
  const q = classify({
    label: 'Are you straight gay bi or queer',
    options: ['Straight', 'Gay', 'Bi', 'Queer'],
  });
  assert.equal(q.class, 'eeo:orientation');
});

test('ethnicities stem hits the ethnicity class', () => {
  assert.equal(
    classify({ label: 'Please select up to 2 ethnicities that you most closely identify with?' }).class,
    'eeo:ethnicity'
  );
});

test('US/Canada polarity is location:in_us, not a city dump', () => {
  const q = classify({
    label: 'Are you based in the United States or Canada?',
    type: 'checkbox',
    options: ['Yes', 'No'],
  });
  assert.equal(q.class, 'location:in_us');
  assert.equal(q.factValue, 'Yes');
});

test('Phone is identity:phone, phone country stays country', () => {
  assert.equal(classify({ label: 'Phone', type: 'tel' }).class, 'identity:phone');
  assert.equal(
    classify({ label: 'Phone country', type: 'combobox', reactSelect: true }).class,
    'identity:country'
  );
});

test('permanent residency is identity:state', () => {
  const q = classify({ label: 'In which state do you hold permanent residency?*', type: 'text' });
  assert.equal(q.class, 'identity:state');
  assert.equal(q.factValue, null);
});

test('refer you and covenants are closed No classes', () => {
  assert.equal(classify({ label: 'Did an employee refer you to apply? *' }).class, 'referral');
  assert.equal(classify({ label: 'Restrictive covenants?' }).class, 'conflict:employer');
  assert.equal(classify({ label: 'Family / SO employed by Flock?' }).class, 'conflict:employer');
});

test('chosenClass remaps onto a different class and can skip', () => {
  const { chosenClass, remapClass, classFitsValue } = require('./question-catalog');
  assert.equal(chosenClass('identity:phone'), 'identity:phone');
  assert.equal(chosenClass('skip'), 'skip');
  assert.equal(remapClass({ label: 'Phone' }, 'identity:phone'), 'identity:phone');
  assert.equal(classFitsValue('identity:country', '5550100199', { label: 'Phone' }), false);
  assert.equal(classFitsValue('identity:phone', '5550100199', { label: 'Phone' }), true);
});

test('phone-country options do not reclassify LinkedIn or cover letter', () => {
  const dial = [
    'Afghanistan+93',
    'Ascension Island+247',
    'Canada+1',
    'Cayman Islands+1',
    'United Kingdom+44',
    'United States+1',
  ];
  assert.notEqual(
    classify({
      label: 'LinkedIn Profile',
      type: 'url',
      options: dial,
    }).class,
    'identity:country'
  );
  assert.equal(
    classifyField({
      label: 'Cover Letter',
      type: 'textarea',
      tag: 'textarea',
      options: dial,
    }).route,
    'needs_llm'
  );
  assert.equal(
    classify({
      label: 'What gender identity do you most closely identify with?',
      type: 'combobox',
      reactSelect: true,
      options: dial,
    }).class,
    'eeo:gender'
  );
});

test('Ashby name fields are not salary even when a JD heading leaked', () => {
  const q = classify({
    label: 'Compensation',
    type: 'text',
    name: '_systemfield_name',
    domId: '_systemfield_name',
  });
  assert.equal(q.class, 'identity:name');
  assert.notEqual(q.kind, 'salary');
  assert.equal(classify({ label: 'What are your base salary expectations?' }).class, 'salary:base');
});

test('hubs proximity is location:hubs, not a city dump', () => {
  const hubs = {
    label: 'Where are you based relative to our hubs?',
    type: 'checkbox',
    options: ['Atlanta, GA', 'Boston, MA', 'London, UK', 'Nairobi, Kenya'],
  };
  const q = classify(hubs);
  assert.equal(q.class, 'location:hubs');
  assert.equal(q.factValue, null);
  assert.equal(q.projector, 'closest');
  assert.equal(classify({ label: 'Where are you based?', type: 'text' }).class, 'location:general');
  const seattle = classify(
    {
      ...hubs,
      options: ['Seattle, WA', 'Atlanta, GA', 'Boston, MA'],
    },
    { identity: { based_city: 'Seattle' } }
  );
  assert.equal(seattle.class, 'location:hubs');
  assert.match(String(seattle.factValue), /Seattle/i);
});

test('learnAlias writes a novel wording onto an allowlisted class', () => {
  const prev = process.env.MAGNET_ALIASES;
  const file = path.join(os.tmpdir(), `magnet-aliases-${process.pid}-${Date.now()}.yaml`);
  fs.writeFileSync(file, 'version: 1\naliases: []\n');
  process.env.MAGNET_ALIASES = file;
  invalidate();
  try {
    const wrote = learnAlias('eeo:orientation', 'SOGI');
    assert.equal(wrote.ok, true);
    assert.equal(classify({ label: 'SOGI question' }).class, 'eeo:orientation');
    assert.equal(learnAlias('other:pokemon', 'Favorite Pokemon'), null);
  } finally {
    if (prev == null) delete process.env.MAGNET_ALIASES;
    else process.env.MAGNET_ALIASES = prev;
    invalidate();
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
});
