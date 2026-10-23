const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harvestDue, harvestAttachScript, harvestSweepScript, autoScrollArmScript, fillAndVerifyScript } = require('./static-fill');

test('harvestDue does not require focusout once the user dirtied the field', () => {
  assert.equal(
    harvestDue({
      paused: false,
      value: 'Queer',
      prefill: 'Select...',
      userDirty: true,
      focused: false,
    }),
    true
  );
  assert.equal(
    harvestDue({
      paused: false,
      value: 'Select...',
      prefill: 'Select...',
      userDirty: true,
      focused: false,
    }),
    false
  );
  assert.equal(
    harvestDue({
      paused: true,
      value: 'Queer',
      prefill: '',
      userDirty: true,
      focused: true,
    }),
    false
  );
  assert.equal(
    harvestDue({
      paused: false,
      value: 'Queer',
      prefill: 'Queer',
      userDirty: false,
      focused: false,
    }),
    false
  );
});

test('harvest attach listens for settle events and exposes a Complete sweep', () => {
  const src = harvestAttachScript();
  assert.match(src, /addEventListener\(\s*'change'/);
  assert.match(src, /addEventListener\(\s*'input'/);
  assert.match(src, /400/);
  assert.match(src, /select__single-value/);
  assert.match(src, /__magnetHarvestSweep/);
  assert.match(harvestSweepScript(), /__magnetHarvestSweep/);
});

test('fill does not yank the page unless auto-scroll is explicitly on', () => {
  const armed = autoScrollArmScript(false);
  assert.match(armed, /__magnetAutoScroll = false/);
  assert.doesNotMatch(armed, /__magnetAutoScroll = true/);
  assert.match(armed, /__magnetAutoScroll !== true/);
  const fill = fillAndVerifyScript('first_name', 'Alex', [], 'First name');
  assert.match(fill, /__magnetAutoScroll !== true/);
  assert.doesNotMatch(fill, /__magnetAutoScroll === false/);
});

test('runStepsScript picks radio options by closest label, not includes(no)', () => {
  const { runStepsScript } = require('./static-fill');
  const src = runStepsScript('m-fam', [{ op: 'clickOption' }], 'No', {
    label: 'Family / SO employed by Flock?',
  });
  assert.match(src, /pickClosestOption/);
  assert.match(src, /labeled-\(radio\|checkbox\)-\\d\+/);
  assert.doesNotMatch(src, /looksLikeChoiceClick/);
  assert.doesNotMatch(src, /\.includes\(key\)/);
  assert.match(src, /Family \/ SO employed by Flock\?/);
});

test('react-select fill finds a portaled menu and only trusts committed chips', () => {
  const src = fillAndVerifyScript('m-orient', 'Queer', ['react_select'], 'What sexual orientation');
  assert.match(src, /menuUsable/);
  assert.match(src, /select__multi-value__label/);
  assert.match(src, /_valueTracker/);
  assert.doesNotMatch(src, /key: 'ArrowDown'/);
  assert.match(src, /else closeMenu\(\)/);
  assert.match(src, /isReactSelect\(\)\s*\n\s*\? reactOk/);
});
