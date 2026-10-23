const { valuesEqual, isEmptyCurrent, looksRequired, looksContaminated, wantsCheckedYes } = require('./audit');
const { pickClosestOption } = require('./option-match');
const { confirmedOrFactValue } = require('./question-class');

function currentOf(field) {
  if (!field) return '';
  return field.current != null ? field.current : field.value;
}

function optionMiss(field, value) {
  const opts = (field && field.options) || [];
  if (!value || !opts.length) return false;
  const pick = pickClosestOption(opts, value, undefined, field.label);
  return !pick || !pick.option;
}

function looksLanded(field, value) {
  if (!field) return false;
  if (isEmptyCurrent(field)) return false;
  if (wantsCheckedYes(field, value)) return false;
  if (looksContaminated(field)) return false;
  const cur = currentOf(field);
  if (value != null && value !== '' && valuesEqual(value, cur, field)) return true;
  if (field.intended && valuesEqual(field.intended, cur, field)) return true;
  if (field.profileValue && valuesEqual(field.profileValue, cur, field)) return true;
  if (field.prefill && field.intended && valuesEqual(field.intended, field.prefill, field) && valuesEqual(field.prefill, cur, field)) {
    return true;
  }
  if (field.magnetState === 'green' && field.fill && field.fill.ok && field.intended && valuesEqual(field.intended, cur, field)) {
    return true;
  }
  return false;
}

function reviewGate(field, { afterRetry } = {}) {
  if (!field) return { ask: false };
  const route = field.route;
  if (route === 'skip' || route === 'needs_llm' || route === 'employment') {
    return { ask: false, reason: 'route' };
  }

  const { q, value, contradicted } = confirmedOrFactValue(field);
  if (contradicted) return { ask: true, reason: 'contradicted' };
  if (wantsCheckedYes(field, value)) {
    if (!afterRetry) return { ask: false, retry: true, reason: 'retry-known', value };
    return { ask: true, reason: 'couldnt-land', value };
  }
  if (looksContaminated(field)) {
    const want = value != null ? value : field.intended;
    return { ask: true, reason: want != null && String(want).trim() !== '' ? 'wrong-intended' : 'unlabeled', value: want };
  }

  if (looksLanded(field, value)) return { ask: false, reason: 'landed', value };

  if (field.residual === 'needs-infer' || field.reason === 'needs-infer') {
    return { ask: true, reason: 'needs-infer', value };
  }

  if (value == null) {
    if (!isEmptyCurrent(field)) return { ask: false, reason: 'landed' };
    const classified = q && q.kind && q.kind !== 'other' && q.class && !q.unlabeled;
    if (classified) {
      return { ask: true, reason: 'no-fact', class: q.class, question: field.label || '' };
    }
    if (q && (q.unlabeled || !q.class || q.kind === 'other')) {
      if (field.residual || looksRequired(field)) {
        return { ask: true, reason: 'unlabeled', question: field.label || '' };
      }
    }
  }

  if (value != null) {
    const cur = currentOf(field);
    if (valuesEqual(value, cur, field)) return { ask: false, reason: 'landed', value };
    if (field.intended && String(field.intended).trim() && valuesEqual(field.intended, cur, field)) {
      return { ask: false, reason: 'landed', value };
    }
    if (q.kind === 'consent') {
      if (looksLanded(field, value) || valuesEqual(value, cur, field)) {
        return { ask: false, reason: 'landed', value };
      }
      if (!afterRetry) return { ask: false, retry: true, reason: 'retry-known', value };
      return { ask: true, reason: 'couldnt-land', value };
    }
    if (optionMiss(field, value)) return { ask: true, reason: 'options-changed', value };
    if (!afterRetry) return { ask: false, retry: true, reason: 'retry-known', value };
    if (isEmptyCurrent(field)) return { ask: true, reason: 'couldnt-land', value };
    return { ask: true, reason: 'wrong-intended', value };
  }

  const fuzzy =
    field.uncertainty &&
    field.uncertainty.confidence &&
    field.uncertainty.confidence !== 'exact' &&
    field.uncertainty.confidence !== 'none';
  if (fuzzy) return { ask: true, reason: 'fuzzy' };
  if (field.residual) return { ask: true, reason: field.residual };
  if (looksRequired(field) && isEmptyCurrent(field)) return { ask: true, reason: 'required_empty' };
  return { ask: false, reason: 'clean' };
}

function shouldAskReview(field, opts) {
  return Boolean(reviewGate(field, opts).ask);
}

function filterAskable(fields, opts) {
  return (fields || []).filter((f) => shouldAskReview(f, opts));
}

function dropLandedFills(fills, fields) {
  const byId = new Map((fields || []).map((f) => [f.id, f]));
  return (fills || []).filter((row) => {
    if (!row || !row.id) return false;
    if (row.gate === 'inferred' || row.gate === 'needs-infer') return true;
    const field = byId.get(row.id) || {};
    if (field.route === 'needs_llm' || field.route === 'employment' || field.route === 'skip') return false;
    const cur = currentOf(field);
    if (row.value != null && row.value !== '' && valuesEqual(row.value, cur, field)) return false;
    if (looksLanded(field, row.value)) return false;
    const gate = reviewGate(field, { afterRetry: true });
    if (!gate.ask && gate.reason === 'landed') return false;
    return true;
  });
}

module.exports = {
  reviewGate,
  shouldAskReview,
  filterAskable,
  looksLanded,
  dropLandedFills,
};
