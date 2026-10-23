const { test } = require('node:test');
const assert = require('node:assert/strict');
const models = require('./models');

test('defaults resolve to grok 4.6 fast', () => {
  const snap = models.snapshot({});
  assert.equal(snap.selection.id, 'grok-4.6');
  assert.equal(snap.selection.params.fast, 'true');
  assert.equal(snap.agent.id, 'grok-4.6');
  assert.deepEqual(
    snap.agent.params.filter((row) => row.id === 'fast'),
    [{ id: 'fast', value: 'true' }]
  );
  assert.match(snap.summary, /Fast/);
});

test('summary uses effort and fast labels', () => {
  const snap = models.snapshot({ modelId: 'grok-4.6', modelParams: { fast: 'true', effort: 'high' } });
  assert.equal(snap.summary, 'High Fast');
  assert.equal(snap.modelLabel, 'Cursor Grok 4.6');
});

test('picking composer keeps only supported params', () => {
  const patch = models.pickModel({ modelId: 'grok-4.6', modelParams: { fast: 'true', effort: 'high' } }, 'composer-2.5');
  assert.equal(patch.modelId, 'composer-2.5');
  assert.equal(patch.modelParams.fast, 'true');
  assert.equal(patch.modelParams.effort, undefined);
});

test('setParam toggles fast and drops empty values', () => {
  const off = models.setParam({ modelId: 'grok-4.6', modelParams: { fast: 'true' } }, 'fast', 'false');
  assert.equal(off.modelParams.fast, 'false');
  const effort = models.setParam(off, 'effort', 'low');
  assert.equal(effort.modelParams.effort, 'low');
});

test('custom models land in the catalog and can be selected', () => {
  const added = models.addCustom({ customModels: [] }, 'my-model');
  assert.deepEqual(added, { modelId: 'my-model', modelParams: {}, customModels: ['my-model'] });
  const snap = models.snapshot(added);
  assert.equal(snap.selection.id, 'my-model');
  assert.ok(snap.catalog.some((row) => row.id === 'my-model'));
  assert.deepEqual(snap.agent, { id: 'my-model' });
});

test('toAgentModel omits empty params', () => {
  assert.deepEqual(models.toAgentModel({ id: 'auto', params: {} }, models.fallbackCatalog()), { id: 'auto' });
});

test('grok 4.6 effort includes Extra High', () => {
  const grok = models.findModel(models.fallbackCatalog(), 'grok-4.6');
  const effort = grok.parameters.find((row) => row.id === 'effort');
  assert.deepEqual(
    effort.values.map((row) => row.value),
    ['low', 'medium', 'high', 'xhigh']
  );
  assert.equal(effort.values.find((row) => row.value === 'xhigh').displayName, 'Extra High');
  const extra = models.setParam({ modelId: 'grok-4.6', modelParams: { fast: 'true' } }, 'effort', 'xhigh');
  assert.equal(extra.modelParams.effort, 'xhigh');
  const snap = models.snapshot(extra);
  assert.equal(snap.summary, 'Extra High Fast');
});

test('slimModel keeps a numeric context window', () => {
  const slim = models.slimModel({
    id: 'composer-2.5',
    displayName: 'Composer 2.5',
    context_window: 200000,
  });
  assert.equal(slim.contextWindow, 200000);
  assert.equal(models.contextWindow(slim), 200000);
  const none = models.slimModel({ id: 'auto', displayName: 'Auto' });
  assert.equal(none.contextWindow, undefined);
  assert.equal(models.contextWindow(none), 128000);
});
