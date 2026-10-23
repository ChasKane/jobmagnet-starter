/** Shared label / question key for recipes and classify. */

const { isInstructionLabel } = require('./question-cascade');

function normalizeQuestion(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeQuestion, isInstructionLabel };
