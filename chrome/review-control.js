/**
 * Review-card value control from a leftover field. UMD: Node `require` and chrome `<script>`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MagnetReviewControl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PLACEHOLDER_RE =
    /^(select|select one|choose|choose one|pick|pick one|please select|n\/a|\.{2,}|-)(\.\.\.)?$/i;

  function fold(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '');
  }

  function optionLabel(o) {
    return String((o && (o.text || o.label || o.value)) || o).trim();
  }

  function placeholderOption(s) {
    return PLACEHOLDER_RE.test(String(s || '').trim());
  }

  function reviewOptionLabels(field) {
    return ((field && field.options) || []).map(optionLabel).filter((o) => o && !placeholderOption(o));
  }

  function familyOf(field) {
    return String((field && field.shape && field.shape.family) || '');
  }

  function typeOf(field) {
    return String((field && field.type) || '').toLowerCase();
  }

  function tagOf(field) {
    return String((field && field.tag) || '').toLowerCase();
  }

  function isSelectFamily(field) {
    if (!field) return false;
    const t = typeOf(field);
    const tag = tagOf(field);
    const family = familyOf(field);
    return Boolean(
      field.select ||
        field.reactSelect ||
        tag === 'select' ||
        t === 'select' ||
        t === 'select-one' ||
        t === 'select-multiple' ||
        t === 'combobox' ||
        t === 'listbox' ||
        family === 'native_select' ||
        family === 'react_select' ||
        family === 'combobox'
    );
  }

  function isChoiceGroup(field) {
    if (!field) return false;
    const t = typeOf(field);
    return t === 'radio' || t === 'checkbox' || familyOf(field) === 'choice_group';
  }

  function isLongBox(field) {
    if (!field) return false;
    const t = typeOf(field);
    const tag = tagOf(field);
    return tag === 'textarea' || t === 'textarea' || Boolean(field.contenteditable) || Number(field.maxlength) >= 200;
  }

  function matchReviewOption(options, value) {
    const raw = String(value || '').trim();
    if (!raw || placeholderOption(raw)) return '';
    const list = options || [];
    const exact = list.find((o) => o === raw);
    if (exact) return exact;
    const lower = raw.toLowerCase();
    const ci = list.find((o) => o.toLowerCase() === lower);
    if (ci) return ci;
    const f = fold(raw);
    return list.find((o) => fold(o) === f) || '';
  }

  function selectedReviewChoices(options, value) {
    const raw = String(value || '').trim();
    if (!raw || placeholderOption(raw)) return [];
    const exact = matchReviewOption(options, raw);
    if (exact) return [exact];
    const parts = raw
      .split(/\s*,\s*/)
      .map((p) => matchReviewOption(options, p))
      .filter(Boolean);
    return [...new Set(parts)];
  }

  function withCurrentOption(options, value) {
    const list = (options || []).slice();
    const raw = String(value || '').trim();
    if (!raw || placeholderOption(raw)) return list;
    if (matchReviewOption(list, raw)) return list;
    return [raw, ...list];
  }

  function reviewControl(field) {
    const options = reviewOptionLabels(field);
    const t = typeOf(field);
    const tag = tagOf(field);
    if (t === 'file' || tag === 'file') return { kind: 'file', options: [] };
    if (isLongBox(field) && !isSelectFamily(field) && !isChoiceGroup(field) && options.length < 2) {
      return { kind: 'textarea', options: [] };
    }
    if (t === 'email') return { kind: 'email', options: [] };
    if (t === 'tel' || t === 'phone') return { kind: 'tel', options: [] };
    if (t === 'number' || t === 'range') return { kind: 'number', options: [] };
    if (t === 'url') return { kind: 'url', options: [] };
    if (t === 'date' || t === 'datetime-local' || t === 'month') return { kind: 'text', options: [] };

    if (t === 'checkbox' && options.length <= 1) return { kind: 'checkbox', options };
    if (t === 'select-multiple' && options.length) return { kind: 'checkboxes', options };

    if (isSelectFamily(field) && options.length) return { kind: 'select', options };
    if (isChoiceGroup(field) && options.length) {
      if (t === 'checkbox' && options.length > 1) return { kind: 'checkboxes', options };
      if (options.length > 10) return { kind: 'select', options };
      return { kind: 'radios', options };
    }
    if (options.length >= 2) return { kind: 'select', options };
    if (isSelectFamily(field) || isChoiceGroup(field)) return { kind: 'text', options: [] };
    return { kind: 'text', options: [] };
  }

  return {
    reviewControl,
    reviewOptionLabels,
    matchReviewOption,
    selectedReviewChoices,
    withCurrentOption,
    placeholderOption,
  };
});
