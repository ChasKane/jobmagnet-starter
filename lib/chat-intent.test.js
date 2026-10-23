const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wantsEssayOverride, looksLikeApplyForm } = require('./chat-intent');

test('this-is-an-essay chat is an override', () => {
  assert.equal(wantsEssayOverride('this is actually an essay question'), true);
  assert.equal(wantsEssayOverride('treat this as an essay'), true);
  assert.equal(wantsEssayOverride('seems like a waste of the box'), false);
  assert.equal(wantsEssayOverride('Yes'), false);
});

test('apply-form scrape is not a posting', () => {
  const form = `Software Engineer (Frontend)
SUBMIT YOUR APPLICATION
ATTACH RESUME/CV
ADDITIONAL INFORMATION
If there's anything more you'd like to tell us`;
  const posting = `We're looking for someone with strong product sensibilities.
What we're looking for
Prior experience shipping non-trivial apps using React`;
  assert.equal(looksLikeApplyForm(form), true);
  assert.equal(looksLikeApplyForm(posting), false);
});
