const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseXPath, embedNode, embedDistance, cosine } = require('./dom-embed');

test('parseXPath keeps tag, role, and class from a path skeleton', () => {
  const parts = parseXPath('form>div.field[role=group]>label>input[role=combobox].select__input');
  assert.equal(parts[0].tag, 'form');
  assert.equal(parts[parts.length - 1].tag, 'input');
  assert.equal(parts[parts.length - 1].role, 'combobox');
  assert.ok(parts[parts.length - 1].cls.includes('select__input'));
});

test('same node embeds to itself', () => {
  const field = {
    label: 'Country',
    options: ['United States', 'Canada'],
    shape: {
      family: 'react_select',
      open: 'click-typeahead',
      bits: ['listbox-on-open', 'typeahead', 'clickOption'],
      path: 'div.select__control>div>input[role=combobox]',
      optionHash: 'canada|unitedstates',
    },
  };
  const a = embedNode(field);
  const b = embedNode(field);
  assert.ok(cosine(a.vec, b.vec) > 0.999);
});

test('DOM embeddings are near across hosts for the same widget, far across families', () => {
  const countryGh = {
    label: 'Country',
    options: ['United States', 'Canada'],
    shape: {
      family: 'react_select',
      bits: ['listbox-on-open', 'typeahead', 'clickOption'],
      path: 'form>div.select__control>input[role=combobox]',
      optionHash: 'canada|unitedstates',
      open: 'click-typeahead',
    },
  };
  const countryAshby = {
    label: 'Country',
    options: ['United States', 'Canada'],
    shape: {
      family: 'react_select',
      bits: ['listbox-on-open', 'typeahead', 'clickOption'],
      path: 'form>div.ashby>div.select__control>input[role=combobox]',
      optionHash: 'canada|unitedstates',
      open: 'click-typeahead',
    },
  };
  const age = {
    label: 'What is your age range?',
    options: ['18-24', '25-34'],
    shape: {
      family: 'choice_group',
      bits: ['click-label'],
      path: 'fieldset>label',
      optionHash: '1824|2534',
      open: 'visible',
    },
  };
  const same = embedDistance(countryGh, countryAshby);
  const cross = embedDistance(countryGh, age);
  assert.ok(same.score > 0.8, `country widgets should be near, got ${same.score}`);
  assert.ok(same.rank === 'near' || same.rank === 'exact');
  assert.equal(cross.rank, 'far');
  assert.equal(cross.score, 0);
});
