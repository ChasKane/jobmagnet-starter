/** Document-order pairing: a question-like text block owns the next answer cluster. */

function clipLine(s) {
  return String(s || '')
    .trim()
    .split(/\n/)[0]
    .trim()
    .slice(0, 200);
}

function isInstructionLabel(s) {
  const t = clipLine(s);
  if (!t) return false;
  if (/\?/.test(t)) return false;
  return /^(please\s+)?((check|select|choose|pick)(\s+all)?(\s+that\s+apply)?|(select|choose|pick|check)\s+(one|all)(\s+of\s+the\s+following)?)[:.]?\s*$/i.test(
    t
  );
}

function isSectionChrome(s) {
  const t = clipLine(s);
  if (/equal employment/i.test(t) && !/\?/.test(t) && t.length < 80) return true;
  return /^(additional questions?|required questions?|optional questions?|links?|education|experience|work history|eeo|equal employment|voluntary( self[- ]identification)?|demographics?|self-identification|submit( your application)?|resume\/?cv|application|personal info(rmation)?)$/i.test(
    t
  );
}

function aliasNeedles() {
  if (typeof MAGNET_ALIAS_NEEDLES !== 'undefined') return MAGNET_ALIAS_NEEDLES;
  try {
    return require('./question-catalog').aliasNeedles();
  } catch (_) {
    return [];
  }
}

function aliasNeedleHit(s) {
  const hay = String(s || '').toLowerCase();
  if (!hay) return false;
  return aliasNeedles().some((n) => n && hay.includes(n));
}

function isHeadingQuestion(s) {
  const t = clipLine(s);
  if (t.length < 2 || t.length > 240) return false;
  if (isInstructionLabel(t) || isSectionChrome(t)) return false;
  if (/\?/.test(t)) return true;
  return /^(how|where|what|when|why|which|who|are you|do you|have you|will you|would you|can you|did you|please (tell|describe|list|indicate|specify|explain|share)|if other|other,? please)\b/i.test(
    t
  );
}

function isQuestionLike(s) {
  const t = clipLine(s);
  if (t.length < 2 || t.length > 240) return false;
  if (isInstructionLabel(t) || isSectionChrome(t)) return false;
  if (isHeadingQuestion(t)) return true;
  return aliasNeedleHit(t);
}

/**
 * Pair a document-order stream of blocks to control ids.
 * events: { kind: 'question'|'instruction'|'control', text?, id?, cluster? }
 */
function pairCascade(events) {
  const out = {};
  let pending = '';
  let consumed = false;
  let lastCluster = '';
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.kind === 'question' && isQuestionLike(ev.text)) {
      pending = clipLine(ev.text);
      consumed = false;
      continue;
    }
    if (ev.kind === 'instruction' || (ev.kind === 'text' && isInstructionLabel(ev.text))) {
      continue;
    }
    if (ev.kind === 'text' && isQuestionLike(ev.text)) {
      pending = clipLine(ev.text);
      consumed = false;
      continue;
    }
    if (ev.kind !== 'control') continue;
    const cluster = String(ev.cluster || ev.id || '');
    if (lastCluster && cluster && cluster !== lastCluster && consumed) {
      pending = '';
    }
    if (pending) out[ev.id] = pending;
    consumed = Boolean(pending);
    lastCluster = cluster || lastCluster;
  }
  return out;
}

function pageCascadeSource() {
  let needles = [];
  try {
    needles = require('./question-catalog').aliasNeedles();
  } catch (_) {}
  return [
    'const MAGNET_ALIAS_NEEDLES = ' + JSON.stringify(needles) + ';',
    'const isInstructionLabel = ' + isInstructionLabel.toString() + ';',
    'const isSectionChrome = ' + isSectionChrome.toString() + ';',
    'const aliasNeedles = ' + aliasNeedles.toString() + ';',
    'const aliasNeedleHit = ' + aliasNeedleHit.toString() + ';',
    'const isHeadingQuestion = ' + isHeadingQuestion.toString() + ';',
    'const isQuestionLike = ' + isQuestionLike.toString() + ';',
    'const clipLine = ' + clipLine.toString() + ';',
    'const pairCascade = ' + pairCascade.toString() + ';',
  ].join('\n    ');
}

module.exports = {
  clipLine,
  isInstructionLabel,
  isSectionChrome,
  isHeadingQuestion,
  isQuestionLike,
  pairCascade,
  pageCascadeSource,
};
