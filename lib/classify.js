const { normalizeQuestion } = require('./normalize');
const catalog = require('./question-catalog');

function classifyField(field, ctx = {}) {
  return catalog.route(field, ctx);
}

module.exports = { classifyField, normalizeQuestion };
