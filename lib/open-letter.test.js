const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  COVER_LETTER,
  isCannedOpenLetter,
  isReplaceableEssay,
  coverLetterText,
} = require('./open-letter');

test('cover letter and open anything-else boxes take the canned letter', () => {
  const yes = [
    'Cover Letter',
    'Cover letter (optional)',
    'Please paste your cover letter',
    'Motivation letter',
    'Letter of interest',
    'Letter of motivation',
    'Covering letter',
    'Add your cover letter',
    'In your cover letter, tell us why you want to work here',
    "Anything else you'd like us to know?",
    'Is there anything else you would like us to know?',
    'Anything else?',
    'Additional information',
    'Additional comments (optional)',
    "Please share anything else you'd like us to know about you",
    'Is there anything else we should know?',
    'Other information',
    'Anything else you want to tell us?',
    'What else should we know?',
    'Please include any additional information you would like us to consider',
  ];
  for (const label of yes) {
    assert.equal(isCannedOpenLetter({ label, tag: 'textarea', type: 'textarea' }), true, label);
  }
  assert.equal(isCannedOpenLetter({ label: '', name: 'cover_letter', tag: 'textarea' }), true);
});

test('other written questions stay on the generator', () => {
  const no = [
    'Why do you want to work here?',
    'Tell us about a time you solved a hard problem',
    "Please share one project you're most proud of",
    'What interests you about this role?',
    'Describe your experience with React',
    'Why this company?',
    'Additional information about your work authorization',
    'Anything else about your experience with distributed systems?',
    'How many years of experience do you have?',
    'Work experience',
    'Why do you want this role? Tell us in your own words.',
    'Tell us about a challenge. Anything else?',
    'Do not include a cover letter. Describe a bug you fixed.',
    'What else have you built?',
  ];
  for (const label of no) {
    assert.equal(isCannedOpenLetter({ label, tag: 'textarea', type: 'textarea' }), false, label);
  }
  assert.equal(
    isCannedOpenLetter({ label: 'Cover letter', type: 'file', tag: 'input' }),
    false
  );
  assert.equal(
    isCannedOpenLetter({
      label: 'Would you like to add a cover letter?',
      type: 'radio',
      options: ['Yes', 'No'],
    }),
    false
  );
  assert.equal(
    isCannedOpenLetter({ label: 'Cover letter', type: 'text', maxlength: 40 }),
    false
  );
  assert.equal(
    isCannedOpenLetter({ label: 'Why us?', name: 'cover_letter', tag: 'textarea' }),
    false
  );
});

test('placeholder text can be replaced and the letter is the one on file', () => {
  assert.equal(isReplaceableEssay(''), true);
  assert.equal(isReplaceableEssay('Let me think on this…'), true);
  assert.equal(isReplaceableEssay('I already wrote this.'), false);
  assert.equal(coverLetterText(), COVER_LETTER);
  assert.match(coverLetterText(), /^I have friends everywhere\./);
  assert.match(coverLetterText(), /Give me a problem no one has solved yet\.$/);
  assert.equal(coverLetterText().split(/\n\n/).length, 9);
  assert.match(coverLetterText(), /all walks of life\.\n\nI had a night terror/);
  assert.match(coverLetterText(), /always had been\.\n\nIt was a familiar feeling/);
  assert.match(coverLetterText(), /between jobs went to/);
  assert.ok(coverLetterText(80).length <= 80);
  assert.match(coverLetterText(80), /^I have friends everywhere\./);
});
