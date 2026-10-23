const { normalizeQuestion } = require('./normalize');
const {
  sameGroup,
  fold,
  placeholderOption,
  boolLeadIn,
  pickClosestOption,
  currentMatchesOption,
  looksLikeDialCountryList,
  looksLikeDialCountryValue,
  isClosedChoiceField,
} = require('./option-match');

const CANARY_LABEL_RE = /\b(secret word|keyword|application code|prove you read|from the (job )?posting)\b/i;

function isTightCanaryField(field) {
  return CANARY_LABEL_RE.test(String((field && field.label) || ''));
}

function isShortTextField(field) {
  if (!field) return false;
  if (field.select || field.reactSelect) return false;
  const t = String(field.type || '').toLowerCase();
  if (t === 'combobox' || t === 'listbox' || t === 'checkbox' || t === 'radio' || t === 'select') return false;
  return true;
}

function normVal(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[$,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function boolish(s) {
  const v = normVal(s);
  if (/^(yes|true|on|1)$/.test(v)) return 'yes';
  if (/^(no|false|off|0)$/.test(v)) return 'no';
  return '';
}

function valuesEqual(intended, current, field) {
  if (placeholderOption(current) && placeholderOption(intended)) return true;
  if (placeholderOption(current)) return false;
  const a = normVal(intended);
  const b = normVal(current);
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a === b) return true;
  const ba = boolish(a);
  const bb = boolish(b);
  if (ba && bb && ba === bb) return true;
  if (
    ba === 'yes' &&
    field &&
    String(field.type || '').toLowerCase() === 'checkbox' &&
    field.checked &&
    b &&
    !bb
  ) {
    return true;
  }
  if (boolLeadIn(intended, current)) return true;
  const da = a.replace(/[^\d.]/g, '');
  const db = b.replace(/[^\d.]/g, '');
  if (da.length >= 4 && da === db) return true;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
  if (sameGroup(intended, current)) return true;
  if (/^\+?1$/.test(a.replace(/\s/g, '')) && sameGroup('US', current)) return true;
  if (/^\+?1$/.test(b.replace(/\s/g, '')) && sameGroup('US', intended)) return true;
  const fa = fold(intended);
  const fb = fold(current);
  if (fa.length >= 5 && fb.length >= 5 && (fa.includes(fb) || fb.includes(fa))) return true;
  if (field && (field.options || []).length) {
    if (currentMatchesOption(current, field)) {
      const pick = pickClosestOption(field.options, intended, undefined, field.label);
      if (pick && pick.option && (fold(pick.option) === fb || sameGroup(pick.option, current))) return true;
    }
    const pickIntended = pickClosestOption(field.options, intended, undefined, field.label);
    const pickCurrent = pickClosestOption(field.options, current, undefined, field.label);
    if (
      pickIntended &&
      pickIntended.option &&
      pickCurrent &&
      pickCurrent.option &&
      (fold(pickIntended.option) === fold(pickCurrent.option) || sameGroup(pickIntended.option, pickCurrent.option))
    ) {
      return true;
    }
  }
  if (
    field &&
    field.uncertainty &&
    field.uncertainty.picked &&
    (fold(field.uncertainty.picked) === fb || sameGroup(field.uncertainty.picked, current))
  ) {
    return true;
  }
  return false;
}

function isEmptyCurrent(field) {
  const cur = String((field && field.current) != null ? field.current : (field && field.value) || '').trim();
  if (!cur) return true;
  if (
    field &&
    String(field.type || '').toLowerCase() === 'checkbox' &&
    !field.checked
  ) {
    const lab = String(field.label || '').trim();
    if (/^(no|false|off|0)$/i.test(cur)) {
      const opts = (field.options || []).map((o) => String((o && (o.text || o.label || o.value)) || o || '').trim());
      if (!opts.some((o) => /^(no|false)$/i.test(o))) return true;
    }
    if (lab && (normVal(lab) === normVal(cur) || (cur.length > 40 && lab.includes(cur)) || (lab.length > 40 && cur.includes(lab.slice(0, 48))))) {
      return true;
    }
  }
  return placeholderOption(cur);
}

function currentOf(field) {
  if (!field) return '';
  return field.current != null ? field.current : field.value;
}

function wantsCheckedYes(field, value) {
  if (!field || String(field.type || '').toLowerCase() !== 'checkbox') return false;
  if (field.checked) return false;
  const opts = (field.options || []).map((o) => String((o && (o.text || o.label || o.value)) || o || '').trim());
  if (opts.some((o) => /^(no|false)$/i.test(o))) return false;
  return /^(yes|true|i agree|i consent|i acknowledge|i accept)/i.test(String(value || field.intended || ''));
}

function looksContaminated(field) {
  if (!field) return false;
  const cur = String(currentOf(field) || '').trim();
  if (looksLikeDialCountryValue(cur) && !field.phoneCountry) return true;
  if (looksLikeDialCountryList(field.options) && !field.phoneCountry) return true;
  if (!cur) return false;
  const label = String((field && field.label) || '');
  if (
    /linkedin|github|website|portfolio|company|employer|cover letter|preferred name/i.test(label) &&
    /^\+?\d[\d\s().-]{6,}$/.test(cur)
  ) {
    return true;
  }
  const catalog = require('./question-catalog');
  const q = catalog.classify(field);
  if (q && q.class && !catalog.classFitsValue(q.class, cur, field)) return true;
  return false;
}

function hasRequiredStar(text) {
  const s = String(text || '');
  return /[*＊✱※]\s*$/.test(s) || /[?\s][*＊✱※](?:\s|$)/.test(s);
}

function looksRequired(field) {
  if (!field) return false;
  if (field.required) return true;
  return hasRequiredStar(field.label) || hasRequiredStar(field.heading);
}

function isOptionalEmptyField(field) {
  const key = normalizeQuestion((field && field.label) || '');
  if (!key || looksRequired(field)) return false;
  if (/\boptional\b/.test(key)) return true;
  return /twitter|other links|additional links|name pronunciation|pronounce your name/.test(key);
}

function residualReason(field, { canaryPhrases } = {}) {
  const route = field.route;
  if (route === 'skip' || route === 'needs_llm' || route === 'employment') return null;
  const intended = field.intended;
  const current = field.current != null ? field.current : field.value;
  const state = field.magnetState || field.paint || '';
  let fact = null;
  try {
    fact = require('./question-class').confirmedOrFactValue(field).value;
  } catch (_) {}
  if (wantsCheckedYes(field, fact || intended)) return 'intended_neq_current';
  if (looksContaminated(field)) return 'intended_neq_current';
  if (
    fact != null &&
    String(fact).trim() !== '' &&
    !isEmptyCurrent(field) &&
    !valuesEqual(fact, current, field)
  ) {
    return 'intended_neq_current';
  }
  if (intended != null && String(intended) !== '' && valuesEqual(intended, current, field)) return null;
  if ((intended == null || String(intended) === '') && isOptionalEmptyField(field)) return null;
  if (field.reason === 'needs-infer' || field.residual === 'needs-infer') {
    if (state === 'green' && field.fill && field.fill.ok) return null;
    return 'needs-infer';
  }
  if (state === 'skip' || state === 'yellow') {
    if (intended == null || String(intended) === '') return null;
  }
  if (state === 'red') {
    if (isClosedChoiceField(field) && (intended == null || String(intended) === '')) return 'needs-infer';
    return 'red';
  }
  if (intended != null && String(intended) !== '' && !valuesEqual(intended, current, field)) return 'intended_neq_current';
  if (looksRequired(field) && isEmptyCurrent(field)) return 'required_empty';
  const phrases = Array.isArray(canaryPhrases) ? canaryPhrases : [];
  if (isTightCanaryField(field) && phrases.length) {
    const hay = String(current || '');
    if (!phrases.some((p) => hay.includes(p))) return 'canary_miss';
  }
  return null;
}

function slimFindings(findings) {
  const list = (findings && (findings.findings || findings)) || [];
  if (!Array.isArray(list)) return [];
  return list.map((f) => ({
    kind: f.kind,
    id: f.id,
    summary: f.summary,
    phrase: f.phrase,
    snippet: f.snippet,
  }));
}

function auditFields(fields, { canaryPhrases, findings } = {}) {
  const rows = Array.isArray(fields) ? fields : [];
  const audited = rows.map((f) => {
    const residual = residualReason(f, { canaryPhrases });
    const closeEnough =
      f.intended != null &&
      String(f.intended) !== '' &&
      valuesEqual(f.intended, f.current != null ? f.current : f.value, f);
    const landedGreen = f.magnetState === 'green' && f.fill && (f.fill.ok || f.fill.skipped) && !isEmptyCurrent(f);
    const ok =
      f.route === 'skip' ||
      f.route === 'needs_llm' ||
      f.route === 'employment' ||
      (!residual && (f.fill == null || f.fill.ok || f.fill.skipped || closeEnough));
    return {
      ...f,
      residual,
      uncertainty: closeEnough || landedGreen ? null : f.uncertainty,
      ok: Boolean(ok && !residual),
    };
  });
  const residuals = audited.filter((f) => f.residual);
  const staticRows = audited.filter((f) => f.route === 'static');
  const static_ok = staticRows.filter((f) => f.ok).length;
  return {
    fields: audited,
    residuals,
    findings: slimFindings(findings),
    static_ok,
    static_total: staticRows.length,
    residual_count: residuals.length,
  };
}

function auditLogFields(audit) {
  return (audit.fields || []).map((f) => ({
    id: f.id,
    label: f.label,
    route: f.route,
    intended: f.intended || '',
    current: f.current || '',
    ok: Boolean(f.ok),
    residual: f.residual || null,
  }));
}

module.exports = {
  CANARY_LABEL_RE,
  isTightCanaryField,
  isShortTextField,
  valuesEqual,
  isEmptyCurrent,
  hasRequiredStar,
  looksRequired,
  looksContaminated,
  wantsCheckedYes,
  residualReason,
  isOptionalEmptyField,
  slimFindings,
  auditFields,
  auditLogFields,
  normalizeQuestion,
};
