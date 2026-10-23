const { classifyRejection } = require('./mail-classify');
const { matchCompany } = require('./mail-match');

function decide(verdict, match, viaLlm, pause) {
  const submitted = (match && match.submitted) || [];
  const interviewing = (match && match.interviewing) || [];
  const offer = (match && match.offer) || [];

  if (offer.length) return { action: 'queue', reason: 'offer', url: offer[0].url, candidates: match.matches };
  if (interviewing.length) {
    return { action: 'queue', reason: 'interviewing', url: interviewing[0].url, candidates: match.matches };
  }
  if (verdict === 'unsure') {
    return {
      action: 'queue',
      reason: 'unsure',
      url: (submitted[0] || (match.matches && match.matches[0]) || {}).url || null,
      candidates: match.matches,
    };
  }
  if (viaLlm && !(submitted.length === 1 && match.unique)) {
    return { action: 'queue', reason: 'llm_only', url: (submitted[0] || {}).url || null, candidates: match.matches };
  }
  if (pause && submitted.length >= 2) {
    return { action: 'queue', reason: 'company_pause', url: null, candidates: submitted };
  }
  if (submitted.length === 1 && (match.unique || submitted.length === match.active.length)) {
    return { action: 'reject', url: submitted[0].url, candidates: submitted };
  }
  if (submitted.length >= 2) {
    return { action: 'queue', reason: 'ambiguous', url: null, candidates: submitted };
  }
  return { action: 'ignore', reason: 'no-match', url: null, candidates: match.matches || [] };
}

function reviewMessage(msg, jobs) {
  const verdict = classifyRejection(msg);
  const match = matchCompany(msg, jobs || []);
  const decision = decide(verdict && verdict.verdict, match, false, Boolean(verdict && verdict.pause));
  return { verdict, match, decision };
}

module.exports = { decide, reviewMessage, classifyRejection, matchCompany };
