const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCompileJson, wantLlmCompile } = require('./compile-llm');
const { parseReviewJson } = require('./fill-review');

test('parseCompileJson keeps tags people and bounds', () => {
  const { cards } = parseCompileJson(`{
    "cards": [{
      "employer": "Peloton",
      "claim": "Converted bikes page.",
      "proof": "Converted the bikes page to Page Builder.",
      "honesty_bound": "Did not own experiment outcomes.",
      "tags": ["frontend", "experiments"],
      "people": [{"name": "PM", "relation": "teammate"}],
      "question_shapes": ["proud-project"],
      "links": [{"to_employer": "Peloton", "to_claim": "Page Builder", "kind": "same-project"}]
    }]
  }`);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].tags, ['frontend', 'experiments']);
  assert.equal(cards[0].people[0].name, 'PM');
  assert.match(cards[0].honesty_bound, /not own/i);
});

test('heuristic compile stays on when MAGNET_HEURISTIC_COMPILE=1', () => {
  const prev = process.env.MAGNET_HEURISTIC_COMPILE;
  process.env.MAGNET_HEURISTIC_COMPILE = '1';
  process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || 'x';
  assert.equal(wantLlmCompile({}), false);
  assert.equal(wantLlmCompile({ heuristic: true }), false);
  process.env.MAGNET_HEURISTIC_COMPILE = prev;
});

test('review parser keeps recipes and drops eval runs', () => {
  const parsed = parseReviewJson(`{
    "reply": "ok",
    "fills": [{"id": "f1", "value": "No"}],
    "asks": [],
    "runs": [],
    "recipes": [{
      "field_id": "f1",
      "label": "Need sponsorship?",
      "profile_key": "work.requires_sponsorship_now_or_future",
      "value": "No",
      "reason": "Closed fact"
    }, {
      "field_id": "bad",
      "label": "Hack",
      "run": { "source": "document.body.innerHTML=''" }
    }],
    "profile_updates": [
      { "path": "identity.age", "value": 30 },
      { "employer": "Peloton", "text": "Owned Page Builder" }
    ]
  }`);
  assert.equal(parsed.recipes.length, 1);
  assert.equal(parsed.recipes[0].profile_key, 'work.requires_sponsorship_now_or_future');
  assert.equal(parsed.fills[0].value, 'No');
  assert.deepEqual(parsed.profile_updates, [
    { path: 'identity.age', value: 30, class_id: '', id: '', label: '' },
  ]);
});
