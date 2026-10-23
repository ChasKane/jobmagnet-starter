const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fieldBucket,
  reviewCounts,
  filterFields,
  pipelineLines,
  strategyChoices,
  strategyLabel,
  routeLabel,
} = require('./review-insight');

test('buckets follow route, paint state, and fill outcome', () => {
  assert.equal(fieldBucket({ route: 'static', magnetState: 'green' }), 'filled');
  assert.equal(fieldBucket({ route: 'static', magnetState: 'red', residual: 'couldnt-land' }), 'leftover');
  assert.equal(fieldBucket({ route: 'needs_llm', magnetState: 'orange' }), 'essay');
  assert.equal(fieldBucket({ route: 'skip', magnetState: 'skip' }), 'skip');
  assert.equal(fieldBucket({ route: 'employment' }), 'skip');
  assert.equal(fieldBucket({ route: 'static', fill: { ok: true, skipped: 'optional-empty' } }), 'skip');
});

test('counts and filters cover a mixed page', () => {
  const fields = [
    { id: 'a', route: 'static', magnetState: 'green' },
    { id: 'b', route: 'static', magnetState: 'red', residual: 'red' },
    { id: 'c', route: 'needs_llm', magnetState: 'orange' },
    { id: 'd', route: 'skip', magnetState: 'skip' },
  ];
  assert.deepEqual(reviewCounts(fields), {
    all: 4,
    filled: 1,
    leftover: 1,
    essay: 1,
    skip: 1,
    other: 0,
    need: 1,
  });
  assert.deepEqual(
    filterFields(fields, 'need').map((f) => f.id),
    ['b']
  );
  assert.equal(filterFields(fields, 'all').length, 4);
});

test('pipeline names the classify → fact → write path', () => {
  const lines = pipelineLines({
    route: 'static',
    reason: 'catalog-eeo',
    qClass: 'eeo:orientation',
    qKind: 'eeo',
    profileValue: 'Queer',
    intended: 'Queer',
    current: '',
    shape: { family: 'react_select' },
    fill: { ok: false, reason: 'unverified', strategy: '', chain: ['react_select', 'native_value'] },
    recipeHit: { label_key: 'orientation', match: 'near', has_steps: true },
    gate: 'couldnt-land',
  });
  const by = Object.fromEntries(lines.map((l) => [l.k, l.v]));
  assert.match(by.Route, /Known fact/);
  assert.match(by.Route, /catalog-eeo/);
  assert.match(by.Class, /eeo:orientation/);
  assert.equal(by.Fact, 'Queer');
  assert.equal(by.Widget, 'react_select');
  assert.match(by.Tried, /React Select/);
  assert.match(by.Recipe, /orientation/);
  assert.equal(by.Gate, 'couldnt-land');
});

test('strategy choices annotate cache wins and the strategy that landed', () => {
  const choices = strategyChoices(
    {
      shape: { family: 'text' },
      fill: { ok: true, strategy: 'date_mask', chain: ['date_mask', 'native_value'] },
    },
    {
      text: {
        last_success: 'native_value',
        human_flags: [],
        strategies: { native_value: { wins: 89, losses: 22 } },
      },
    }
  );
  assert.equal(choices[0].name, 'date_mask');
  assert.equal(choices[0].won, true);
  assert.equal(choices[0].last, false);
  assert.equal(choices.find((c) => c.name === 'native_value').last, true);
  assert.equal(strategyLabel('date_mask'), 'Date mask');
  assert.equal(routeLabel('needs_llm'), 'Essay');
});
