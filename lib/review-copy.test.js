const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  reviewGateKind,
  reviewCardKind,
  reviewCardWhy,
  reviewAskWhy,
} = require('./review-copy');

test('unlabeled leftover is Unknown question, not Missing fact', () => {
  const row = { label: 'School', reason: 'Unlabeled question', gate: 'unlabeled', value: '' };
  assert.equal(reviewGateKind(row), 'unknown');
  assert.equal(reviewCardKind(row), 'Unknown question');
  assert.doesNotMatch(reviewCardKind(row), /missing fact/i);
  assert.doesNotMatch(reviewCardWhy(row), /unlabeled question/i);
  assert.match(reviewCardWhy(row), /Ask below/);
});

test('no-fact leftover names the gap, not the question again', () => {
  const row = { label: 'What is your age range?', gate: 'no-fact', reason: 'No fact for age:range', value: '' };
  assert.equal(reviewCardKind(row), 'No stored fact');
  assert.match(reviewCardWhy(row), /no profile value/i);
  assert.match(reviewCardWhy(row, { control: 'select' }), /Pick an option and Save/);
  assert.doesNotMatch(reviewCardWhy(row), /What is your age range/);
  assert.equal(reviewAskWhy('no-fact', 'age:range'), 'No profile value for age:range');
  assert.equal(reviewAskWhy('unlabeled', ''), '');
  assert.match(
    reviewCardWhy({ ...row, pageValue: '25-34' }),
    /Page already shows/
  );
});

test('couldnt-fill copy points at the red record button', () => {
  const row = { label: 'City', value: 'Mesa', gate: 'couldnt-land', reason: 'Could not fill' };
  assert.equal(reviewCardKind(row), "Couldn't fill");
  assert.match(reviewCardWhy(row, { family: 'react_select' }), /red button/);
  assert.equal(reviewCardKind(row, { recording: true }), 'Recording fill');
  assert.match(reviewCardWhy(row, { recording: true }), /Stop/);
});

test('wrong value flag copy stays a Check this fill card', () => {
  const row = {
    label: 'Family / SO employed by Flock?',
    gate: 'wrong-intended',
    value: 'No',
    reason: 'Magnet put a different value',
  };
  assert.equal(reviewGateKind(row), 'wrong');
  assert.equal(reviewCardKind(row), 'Check this fill');
  assert.equal(reviewGateKind({ reason: 'Wrong value — type the right one' }), 'wrong');
  assert.match(
    reviewCardWhy({ ...row, previous: 'Immediate family member' }),
    /Immediate family member/
  );
});

test('wrong-intended leftover asks if Magnet put the right value', () => {
  const row = { label: 'Are you based in the United States or Canada?', gate: 'wrong-intended', value: 'Suite 106' };
  assert.equal(reviewGateKind(row), 'wrong');
  assert.equal(reviewCardKind(row), 'Check this fill');
  assert.match(reviewCardWhy(row), /Suite 106/);
  assert.match(reviewCardWhy(row), /Leave blank/);
});

test('fuzzy leftover is an Unsure card, not a note', () => {
  const { reviewGateKind, reviewKindClass } = require('./review-copy');
  const row = { label: 'How did you hear about us?', gate: 'fuzzy', value: 'LinkedIn', reason: 'fuzzy' };
  assert.equal(reviewGateKind(row), 'unsure');
  assert.equal(reviewCardKind(row), 'Unsure');
  assert.equal(reviewKindClass(row), 'review-kind-unsure');
  assert.match(reviewCardWhy(row), /Confirm or correct/);
});

test('leftover debug fields become review rows when review is empty', () => {
  const { leftoverReviewRows } = require('./review-copy');
  const rows = leftoverReviewRows(
    [
      {
        id: 'title',
        label: 'Job Title*',
        route: 'static',
        intended: 'Software Engineer',
        current: 'I currently work here',
        residual: 'red',
        magnetState: 'red',
        reason: 'heuristic-static',
        fill: { ok: false, strategy: 'native_value', chain: ['native_value'] },
      },
      {
        id: 'co',
        label: 'Company*',
        route: 'static',
        intended: '',
        current: '',
        residual: 'red',
        magnetState: 'red',
      },
      {
        id: 'cover',
        label: 'Cover Letter',
        route: 'needs_llm',
        residual: 'red',
        magnetState: 'red',
      },
      {
        id: 'ok',
        label: 'First Name',
        route: 'static',
        intended: 'Alex',
        current: 'Alex',
        magnetState: 'green',
      },
    ],
    []
  );
  assert.equal(rows.some((r) => r.id === 'title'), true);
  assert.equal(rows.some((r) => r.id === 'co'), true);
  assert.equal(rows.some((r) => r.id === 'cover'), false);
  assert.equal(rows.some((r) => r.id === 'ok'), false);
  assert.equal(rows.find((r) => r.id === 'title').value, 'Software Engineer');
  assert.equal(rows.find((r) => r.id === 'title').classifyReason, 'heuristic-static');
  assert.equal(rows.find((r) => r.id === 'title').fill.strategy, 'native_value');
  assert.equal(leftoverReviewRows(rows.map((r) => ({ ...r, residual: 'red' })), rows).length, 0);
});

test('closed hub leftovers stay in leftover review with cluster options', () => {
  const { leftoverReviewRows, reviewGateKind, reviewCardKind, reviewCardWhy } = require('./review-copy');
  const hubs = {
    id: 'hubs',
    label: 'Where are you based relative to our hubs?',
    route: 'static',
    type: 'checkbox',
    options: ['Atlanta, GA', 'Boston, MA', 'London, UK', 'Nairobi, Kenya'],
    intended: '',
    current: '',
    residual: 'needs-infer',
    magnetState: 'red',
    profileValue: 'Seattle',
  };
  const rows = leftoverReviewRows([hubs], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gate, 'needs-infer');
  assert.deepEqual(rows[0].options, hubs.options);
  const inferred = {
    ...rows[0],
    gate: 'inferred',
    value: 'Atlanta, GA',
    profileValue: 'Seattle',
  };
  assert.equal(reviewGateKind(inferred), 'inferred');
  assert.equal(reviewCardKind(inferred), 'Inferred from profile');
  assert.match(reviewCardWhy(inferred), /Seattle/);
  assert.match(reviewCardWhy(inferred), /Atlanta/);
});
