const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyFocusEvent, clearChatTarget, chromeTarget, dismissChatTarget, teachPendingFrom, targetBarText } = require('./chat-target');

test('sticky target survives chrome blur', () => {
  const tab = {
    debugFields: [{ id: 'tw', label: 'Twitter URL', route: 'static' }],
  };
  applyFocusEvent(tab, { id: 'tw', focused: true });
  assert.equal(tab.chatTarget.id, 'tw');
  applyFocusEvent(tab, { id: 'tw', focused: false });
  assert.equal(tab.chatTarget.id, 'tw');
});

test('page click focuses the matching review row', () => {
  const tab = {
    debugFields: [
      { id: 'country', label: 'Country', route: 'static' },
      { id: 'city', label: 'City', route: 'static', controls: [{ id: 'city-inner' }] },
    ],
  };
  applyFocusEvent(tab, { id: 'city-inner', focused: true });
  assert.equal(tab.reviewFocus, 'city');
  assert.equal(tab.focusedFieldId, 'city');
  applyFocusEvent(tab, { id: 'country', focused: true });
  assert.equal(tab.reviewFocus, 'country');
});

test('leftover review teach is the visible target', () => {
  const tab = {
    review: { asks: [{ id: 'a1', question: 'What is your Twitter URL?' }] },
  };
  const teach = teachPendingFrom(tab);
  assert.equal(teach.kind, 'ask');
  assert.equal(targetBarText(null, teach), 'What is your Twitter URL?');
});

test('leftover fills and missing facts stay off the chat chip', () => {
  assert.equal(
    teachPendingFrom({
      review: { fills: [{ id: 'tw', label: 'Twitter URL', accepted: false }] },
    }),
    null
  );
  assert.equal(
    teachPendingFrom({
      review: { runs: [{ id: 'tw', label: 'Twitter script', source: 'click()' }] },
    }),
    null
  );
  assert.equal(
    teachPendingFrom({
      review: {
        asks: [{ id: 'age', question: 'What is your age range?', reason: 'no-fact', class: 'age:range' }],
      },
    }),
    null
  );
  assert.equal(
    teachPendingFrom({
      review: { asks: [{ id: 'poke', question: 'Favorite Pokemon?', reason: 'unlabeled' }] },
    }),
    null
  );
  const focused = chromeTarget({
    review: { fills: [{ id: 'tw', label: 'Twitter URL' }] },
    chatTarget: { id: 'cover', label: 'Cover letter', route: 'needs_llm' },
  });
  assert.equal(focused.teachPending, null);
  assert.equal(focused.targetBarText, 'Cover letter');
});

test('target bar is the question, not fill copy', () => {
  const text = targetBarText({ id: 'tw', label: 'Twitter URL', route: 'static' }, null);
  assert.equal(text, 'Twitter URL');
  assert.doesNotMatch(text, /next fill|editing|context/i);
  const tab = { chatTarget: { id: 'tw', label: 'Twitter URL', route: 'static' }, focusedFieldId: 'tw' };
  assert.equal(chromeTarget(tab).targetBarText, 'Twitter URL');
  assert.equal(
    targetBarText({ id: 'cover', label: 'Cover letter' }, { kind: 'fill', label: 'Twitter URL' }),
    'Cover letter'
  );
});

test('dismiss clears the target', () => {
  const tab = { chatTarget: { id: 'x', label: 'Age' }, focusedFieldId: 'x' };
  clearChatTarget(tab);
  assert.equal(tab.chatTarget, null);
  assert.equal(tab.focusedFieldId, '');
});

test('dismiss hex skips leftover teach so the chip can hide', () => {
  const tab = {
    review: { asks: [{ id: 'a1', question: 'What is your Twitter URL?' }] },
    chatTarget: { id: 'tw', label: 'Twitter URL' },
    focusedFieldId: 'tw',
  };
  dismissChatTarget(tab);
  assert.equal(tab.chatTarget, null);
  assert.equal(tab.review.asks[0].answered, true);
  assert.equal(teachPendingFrom(tab), null);
});
