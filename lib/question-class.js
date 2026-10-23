const catalog = require('./question-catalog');

function fieldLabel(field) {
  return catalog.fieldLabel(field);
}

function classifyQuestion(field, profile) {
  const q = catalog.classify(field, profile);
  return {
    class: q.class,
    kind: q.kind,
    factValue: q.factValue,
    skillId: q.skillId,
    projector: q.projector,
    unlabeled: q.unlabeled,
    route: q.route,
  };
}

function confirmedOrFactValue(field, profile) {
  const q = classifyQuestion(field, profile);
  const { getConfirmation } = require('./confirmations');
  const conf = q.class ? getConfirmation(q.class) : null;
  if (conf && conf.confidence === 'contradicted') {
    return { q, conf, value: null, contradicted: true };
  }
  if (conf && conf.confidence === 'confirmed' && String(conf.value || '').trim()) {
    const raw = String(conf.value).trim();
    if (!q.class || catalog.classFitsValue(q.class, raw, field)) {
      return { q, conf, value: raw, contradicted: false };
    }
  }
  if (q.factValue != null && String(q.factValue).trim() !== '') {
    return { q, conf, value: String(q.factValue).trim(), contradicted: false };
  }
  return { q, conf, value: null, contradicted: false };
}

module.exports = {
  classifyQuestion,
  confirmedOrFactValue,
  fieldLabel,
};
