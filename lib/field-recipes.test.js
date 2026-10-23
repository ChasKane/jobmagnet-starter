const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchingProfileKey, recipeValue } = require('./field-recipes');
const { isInstructionLabel } = require('./normalize');

test('does not bind a year count to a coincidental profile field', () => {
  const profile = {
    identity: { phone_country_code: '1', first_name: 'Alex' },
    work: { compensation: { target_usd: 150000 } },
  };
  assert.equal(matchingProfileKey(profile, '1'), undefined);
  assert.equal(matchingProfileKey(profile, '0'), undefined);
  assert.equal(matchingProfileKey(profile, '150000'), undefined);
  assert.equal(matchingProfileKey(profile, 'Alex'), 'identity.first_name');
});

test('recipes do not serve stored answers', () => {
  const profile = { identity: { phone_country_code: '1' } };
  assert.equal(recipeValue({ value: '1' }, profile), null);
  assert.equal(recipeValue({ profile_key: 'identity.phone_country_code', value: 'US' }, profile), null);
});

test('react-select steps infer a shape family', () => {
  const { inferShapeFromRecipe } = require('./field-recipes');
  const shape = inferShapeFromRecipe({
    steps: [
      { op: 'click', selector: '.select__control' },
      { op: 'type' },
      { op: 'clickOption' },
    ],
  });
  assert.equal(shape.family, 'react_select');
});

test('instruction labels are not the question', () => {
  assert.equal(isInstructionLabel('Please check all that apply:'), true);
  assert.equal(isInstructionLabel('Please select all that apply'), true);
  assert.equal(isInstructionLabel('Select one of the following'), true);
  assert.equal(isInstructionLabel('How did you hear about Hive?'), false);
});

test('empty text fingerprints do not match as a shared recipe', () => {
  const { findRecipe } = require('./field-recipes');
  const hit = findRecipe({
    label: 'First Name',
    field: {
      type: 'text',
      tag: 'input',
      shape: { family: 'text', open: 'visible', optionHash: '', bits: ['native_value'], path: 'form>input.name' },
    },
  });
  assert.notEqual(hit && hit.match, 'exact');
  assert.ok(!hit || hit.value == null);
});

test('label match does not bind a native-select recipe onto react-select', () => {
  const { findRecipe } = require('./field-recipes');
  const hit = findRecipe({
    label: 'How did you hear about us?',
    field: { reactSelect: true, shape: { family: 'react_select' } },
  });
  assert.notEqual(hit && hit.shape && hit.shape.family, 'native_select');
  assert.notEqual(hit && hit.selector, '#sourceType');
});

test('react-select steps match the same widget family as near, not by host', () => {
  const { findRecipe } = require('./field-recipes');
  const hit = findRecipe({
    label: 'Country',
    field: {
      reactSelect: true,
      type: 'combobox',
      shape: {
        family: 'react_select',
        open: 'click-typeahead',
        optionHash: '',
        bits: ['listbox-on-open', 'typeahead', 'clickOption'],
        path: 'div.select__control>div>input',
      },
    },
  });
  if (hit && hit.steps && hit.steps.length) {
    assert.ok(hit.match === 'near' || hit.match === 'exact');
    assert.equal(hit.value, undefined);
    assert.equal(hit.profile_key, undefined);
  }
});

test('notice poke folds onto existing dance and splits back out', () => {
  const { foldPokeIntoSteps, splitRecipeSteps, isNoticeStrategy } = require('./field-recipes');
  assert.equal(isNoticeStrategy('input_events'), true);
  assert.equal(isNoticeStrategy('native_value'), false);
  const dance = [
    { op: 'click', selector: '.select__control' },
    { op: 'type' },
    { op: 'clickOption' },
  ];
  assert.deepEqual(foldPokeIntoSteps(dance, 'native_value'), dance);
  const folded = foldPokeIntoSteps(dance, 'input_events');
  assert.deepEqual(folded[folded.length - 1], { op: 'poke', strategy: 'input_events' });
  const again = foldPokeIntoSteps(folded, 'input_events');
  assert.equal(again.filter((s) => s.op === 'poke').length, 1);
  const split = splitRecipeSteps(folded);
  assert.equal(split.poke, 'input_events');
  assert.equal(split.dance.length, 3);
  assert.deepEqual(foldPokeIntoSteps([], 'date_mask'), [{ op: 'poke', strategy: 'date_mask' }]);
});

test('recipeRunOk ignores host_includes', () => {
  const { recipeRunOk, hashSource } = require('./field-recipes');
  const source = 'el.value = "x"';
  const recipe = {
    run: { source, hash: hashSource(source) },
    host_includes: ['jobs.lever.co'],
  };
  assert.equal(recipeRunOk(recipe), true);
});

test('date_mask is only for date fields and date-shaped values', () => {
  const { looksLikeDateFill, looksLikeDateLabel } = require('./field-recipes');
  assert.equal(looksLikeDateFill({ label: 'First name', type: 'text' }), false);
  assert.equal(looksLikeDateFill({ label: 'Email' }, { value: 'chas@example.com' }), false);
  assert.equal(looksLikeDateFill({ label: 'how many years of experience' }), false);
  assert.equal(looksLikeDateLabel('start typing to search'), false);
  assert.equal(looksLikeDateFill({ label: 'Start date' }), true);
  assert.equal(looksLikeDateFill({ label: 'From' }, { value: '2020-03' }), true);
  assert.equal(looksLikeDateFill({ type: 'date' }), true);
  assert.equal(looksLikeDateFill({ label: 'City' }, { dates: true }), true);
});

test('positional labeled-radio recipes are not danced', () => {
  const { recipeDanceReady } = require('./field-recipes');
  const field = {
    type: 'radio',
    shape: { family: 'choice_group', optionHash: 'immediatefamilymember|norelationshiptocurrentemployees', path: 'fieldset>input' },
  };
  const recipe = {
    match: 'exact',
    steps: [{ op: 'click', selector: '#_r_abc-labeled-radio-0' }],
    shape: field.shape,
  };
  assert.equal(recipeDanceReady(recipe, null, field), false);
  assert.equal(
    recipeDanceReady({ match: 'exact', steps: [{ op: 'clickOption' }], shape: field.shape }, null, field),
    true
  );
});

test('near recipes are not treated as proved on this page', () => {
  const { recipeDanceReady } = require('./field-recipes');
  const field = { shape: { family: 'react_select', path: 'div.select__control>input', optionHash: '' } };
  assert.equal(recipeDanceReady({ match: 'near', steps: [{ op: 'click' }], shape: field.shape }, null, field), false);
  assert.equal(recipeDanceReady({ match: 'label', steps: [{ op: 'click' }], shape: field.shape }, null, field), false);
  assert.equal(recipeDanceReady({ match: 'exact', steps: [{ op: 'click' }], shape: { family: 'react_select', path: 'div.other>input', optionHash: '' } }, null, field), false);
  assert.equal(recipeDanceReady({ match: 'exact', steps: [{ op: 'click' }], shape: field.shape }, null, field), true);
  assert.equal(recipeDanceReady({ match: 'near' }, [{ op: 'click', selector: '.select__control' }], field), true);
});

test('loaded recipes drop date_mask pokes unless the field is a date', () => {
  const { setRecipeSource, findRecipe } = require('./field-recipes');
  setRecipeSource([
    {
      label_key: 'email uniquefor date mask test',
      steps: [
        { op: 'click', selector: '#email' },
        { op: 'poke', strategy: 'date_mask' },
      ],
    },
    {
      label_key: 'start date uniquefor date mask test',
      steps: [{ op: 'poke', strategy: 'date_mask' }],
    },
  ]);
  try {
    const email = findRecipe({ label: 'email uniquefor date mask test' });
    const start = findRecipe({ label: 'start date uniquefor date mask test' });
    assert.equal(((email && email.steps) || []).some((s) => s.strategy === 'date_mask'), false);
    assert.equal(((start && start.steps) || []).some((s) => s.strategy === 'date_mask'), true);
  } finally {
    setRecipeSource([]);
  }
});
