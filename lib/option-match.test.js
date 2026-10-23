const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hasCommittedChoice,
  boolLeadIn,
  pickClosestOption,
  matchesCandidate,
  usePolarityMatch,
  polarityRegexes,
  pageMatcherSource,
  looksLikeDialCountryList,
  looksLikeDialCountryValue,
  isClosedChoiceField,
} = require('./option-match');

test('half-typed combobox is not committed', () => {
  assert.equal(
    hasCommittedChoice({
      type: 'combobox',
      value: 'University of Cen',
      options: ['University of Central Florida', 'Stanford'],
    }),
    false
  );
});

test('selected combobox option is committed', () => {
  assert.equal(
    hasCommittedChoice({
      type: 'combobox',
      value: 'University of Central Florida',
      options: ['University of Central Florida', 'Stanford'],
    }),
    true
  );
});

test('placeholder select is not committed', () => {
  assert.equal(hasCommittedChoice({ select: true, type: 'select', value: 'Select...' }), false);
});

test('plain text nonempty is committed', () => {
  assert.equal(hasCommittedChoice({ type: 'text', value: 'Alex' }), true);
});

test('boolLeadIn accepts Yes vs long Yes option', () => {
  assert.equal(boolLeadIn('Yes', 'Yes, I intend to work remotely.'), true);
  assert.equal(boolLeadIn('Non-binary', 'Decline To Self Identify'), false);
});

test('named country value skips polarity regex', () => {
  assert.equal(usePolarityMatch('Country or countries you anticipate working from', ['US', 'United States']), false);
  assert.equal(polarityRegexes('Country or countries you anticipate working from', ['US']).length, 0);
});

test('Yes/No and EEO labels still use polarity', () => {
  assert.equal(usePolarityMatch('Do you have a disability?', ['Yes']), true);
  assert.equal(usePolarityMatch('Gender', ['Non-binary']), true);
  assert.ok(polarityRegexes('Do you have a disability?', ['Yes']).length);
});

test('US dial code does not fall through to Afghanistan', () => {
  const pick = pickClosestOption(
    ['Afghanistan (+93)', 'Albania (+355)', 'United States (+1)', 'Canada (+1)'],
    'US',
    ['United States', '+1'],
    'Phone country'
  );
  assert.equal(pick.option, 'United States (+1)');
});

test('Hispanic does not match Not Hispanic', () => {
  assert.equal(matchesCandidate('Not Hispanic or Latino', 'Hispanic or Latino'), false);
  const pick = pickClosestOption(
    ['Hispanic or Latino', 'Not Hispanic or Latino'],
    'Hispanic or Latino',
    [],
    'Ethnicity'
  );
  assert.equal(pick.option, 'Hispanic or Latino');
});

test('age 30 picks the containing range, not a nearby decade', () => {
  const filevine = pickClosestOption(
    ['17 or younger', '18-20', '21-29', '30-39', '40-49', '50-59', '60+', 'Prefer not to answer'],
    '30',
    [],
    'What is your age range?'
  );
  assert.equal(filevine.option, '30-39');
  const eeo = pickClosestOption(['18-24', '25-34', '35-44', 'Prefer not to answer'], 30, [], 'Age');
  assert.equal(eeo.option, '25-34');
});

test('Yes matches long disability option after ranked pick', () => {
  const pick = pickClosestOption(
    ['Yes, I have a disability, or have had one in the past', "No, I don't wish to answer"],
    'Yes',
    [],
    'Disability'
  );
  assert.match(pick.option, /^Yes/);
});

test('No does not match Illinois', () => {
  const pick = pickClosestOption(['Illinois', 'Indiana', 'Iowa'], 'No', [], 'State');
  assert.equal(pick.option, null);
});

test('No matches a whole word later in the option', () => {
  const pick = pickClosestOption(
    ['Illinois', 'I do not need sponsorship, no'],
    'No',
    [],
    'Will you now or in the future require sponsorship?'
  );
  assert.match(pick.option, /\bno\b/i);
});

test('fuzzy match requires a whole word, not a sub-word', () => {
  const pick = pickClosestOption(['Application', 'Catalog', 'Category'], 'cat', [], 'Topic');
  assert.equal(pick.option, null);
});

test('family conflict No is not Immediate family', () => {
  const opts = ['Immediate family member', 'No relationship to current employees', 'Spouse / partner'];
  const pick = pickClosestOption(opts, 'No', [], 'Family / SO employed by Flock?');
  assert.equal(pick.option, 'No relationship to current employees');
  assert.equal(usePolarityMatch('Family member, spouse or significant other employed by Flock?', ['No']), true);
});

test('No matches veteran polarity option', () => {
  const pick = pickClosestOption(
    ['I am a protected veteran', 'I am not a protected veteran'],
    'No',
    ['Not a Veteran'],
    'Veteran status'
  );
  assert.match(pick.option, /not a protected veteran/i);
});

test('fill script interpolates valid matcher source', () => {
  const { fillAndVerifyScript } = require('./static-fill');
  const src = fillAndVerifyScript('m1', 'US', ['combobox'], 'Phone country');
  assert.doesNotThrow(() => new Function('return ' + src));
  assert.doesNotMatch(src, /nodes\[0\]/);
  assert.match(src, /pickChoice\(el\)/);
  assert.match(pageMatcherSource(), /pickDialOption/);
});

test('page matcher source agrees with node picker', () => {
  const page = eval('(function () {\n' + pageMatcherSource() + '\nreturn { pickClosestOption, matchesCandidate, usePolarityMatch, groupOf };\n})()');
  const countries = ['Australia', 'United States', 'Canada'];
  assert.equal(page.pickClosestOption(countries, 'US', [], 'Country').option, 'United States');
  assert.equal(page.usePolarityMatch('Country', ['US']), false);
  assert.equal(page.matchesCandidate('United States', 'US'), true);
  assert.equal(page.matchesCandidate('Yes', 'US'), false);
  assert.equal(page.groupOf('American Samoa'), '');
  assert.equal(page.groupOf('United States of America'), 'us');
});

test('country lists pick USA, not American Samoa', () => {
  const opts = [
    'Please Select',
    'Afghanistan',
    'Åland Islands',
    'Albania',
    'Algeria',
    'American Samoa',
    'Andorra',
    'United States of America',
    'Canada',
  ];
  assert.equal(pickClosestOption(opts, 'United States', [], 'Country').option, 'United States of America');
  assert.equal(pickClosestOption(opts, 'US', ['United States', 'United States of America'], 'Country').option, 'United States of America');
});

test('filled country select stays committed even before USA in the option slice', () => {
  assert.equal(
    hasCommittedChoice({
      select: true,
      type: 'select',
      value: 'United States of America',
      options: ['Afghanistan', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'United States of America'],
    }),
    true
  );
});

test('age projector picks the containing bucket, not string-closest', () => {
  const { pickAgeOption, projectFact } = require('./option-match');
  assert.equal(pickAgeOption(['28-31', '32-38', '39-45'], 35), '32-38');
  const hit = projectFact(['28-31', '32-38', '39-45'], '35', 'age', 'What is your age?');
  assert.equal(hit.option, '32-38');
});

test('dial-code country lists do not land on gender or orientation', () => {
  const dial = [
    'Afghanistan+93',
    'Ascension Island+247',
    'Canada+1',
    'Cayman Islands+1',
    'United Kingdom+44',
    'United States+1',
  ];
  assert.equal(looksLikeDialCountryList(dial), true);
  assert.equal(looksLikeDialCountryValue('Cayman Islands+1'), true);
  assert.equal(looksLikeDialCountryValue('United States +1'), false);
  assert.equal(pickClosestOption(dial, 'United States', [], 'What gender identity do you most closely identify with?').option, null);
  assert.equal(pickClosestOption(dial, 'United States', [], 'Phone country').option, 'United States+1');
});

test('Seattle does not resolve to Seattle Hill', () => {
  const pick = pickClosestOption(
    ['Seattle Hill, United States', 'Seattle, Washington, United States'],
    'Seattle',
    ['Seattle, WA', 'Seattle, Washington', 'Seattle, Washington, United States'],
    'Location (City)'
  );
  assert.equal(pick.option, 'Seattle, Washington, United States');
  assert.equal(matchesCandidate('Seattle Hill, United States', 'Seattle'), false);
});

test('gender polarity does not also select Genderqueer', () => {
  const res = polarityRegexes('What gender identity do you most closely identify with?', ['Non-binary']);
  assert.equal(res.some((re) => re.test('Non-binary')), true);
  assert.equal(res.some((re) => re.test('Genderqueer')), false);
  const only = pickClosestOption(
    ['Genderqueer'],
    'Non-binary',
    ['Nonbinary', 'Non binary'],
    'What gender identity do you most closely identify with?'
  );
  assert.equal(only.option, null);
});

test('closed choice is a widget with scraped options', () => {
  assert.equal(
    isClosedChoiceField({
      type: 'checkbox',
      options: ['Atlanta, GA', 'Boston, MA'],
    }),
    true
  );
  assert.equal(isClosedChoiceField({ type: 'text', label: 'Twitter' }), false);
  assert.equal(isClosedChoiceField({ type: 'checkbox', options: ['I agree'] }), true);
});
