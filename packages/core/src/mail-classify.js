const ATS_FROM =
  /greenhouse-mail\.io|jobs\.greenhouse|greenhouse\.io|lever\.co|hire\.lever|ashbyhq\.com|myworkday\.com|smartrecruiters\.com|icims\.com|workablemail\.com|workable\.com/i;

const REJECT_RE =
  /will not be moving forward|not be moving forward|won'?t be moving forward|other candidates|not selected|we(?:'ve| have) decided not to|unable to (?:move|proceed|advance)|will not be progressing|no longer (?:being )?consider|not advancing|not moving ahead|not the right (?:fit|match) for (?:this|the) (?:role|position)/i;

const FILLED_RE = /position has been filled|role has been filled|we(?:'ve| have) filled (?:the|this) (?:position|role)/i;

const APPLICATION_RE = /\b(application|candidacy|applying|applied|candidate)\b/i;

const RECEIVED_RE =
  /application received|we(?:'ve| have)? received your application|your application (?:has been|was) received|thanks for applying|thank you for (?:your )?(?:interest|appl)|successfully submitted your application/i;

const INTERVIEW_RE =
  /calendly\.com|zoom\.us|schedule (?:an |your )?interview|interview (?:invitation|invite|scheduled|confirmation)|phone screen|meet(?:ing)? invite/i;

const OA_RE = /codesignal|codility|hackerrank|take-?home|assessment invitation|hirevue/i;

const NEXT_STEPS_RE = /\bnext steps\b/i;

const INBOUND_RE =
  /are you open|reached out|i came across your|would you be interested|quick chat|if this (?:role )?isn'?t a fit/i;

const MARKETING_RE = /unsubscribe|view (?:this )?in (?:your )?browser|email preferences|weekly digest|job alert/i;

const PAUSE_RE =
  /paused? hiring|we(?:'ve| have) (?:decided to )?(?:pause|close|cancel) (?:this |the )?(?:role|position|search|hiring)/i;

function haystack(msg) {
  return `${msg.from || ''}\n${msg.subject || ''}\n${msg.text || ''}`;
}

function classifyRejection(msg) {
  const hay = haystack(msg);
  const from = String(msg.from || '');
  const subject = String(msg.subject || '');
  const fromAts = ATS_FROM.test(from);
  const hasReject = REJECT_RE.test(hay) || (FILLED_RE.test(hay) && APPLICATION_RE.test(hay));
  const pause = PAUSE_RE.test(hay);

  if (INTERVIEW_RE.test(hay) && !hasReject) {
    return { verdict: 'not_reject', reason: 'interview', recruiting: true, pause: false };
  }
  if (OA_RE.test(hay) && !hasReject) {
    return { verdict: 'not_reject', reason: 'assessment', recruiting: true, pause: false };
  }
  if (INBOUND_RE.test(hay) && !hasReject) {
    return { verdict: 'not_reject', reason: 'inbound', recruiting: true, pause: false };
  }
  if (RECEIVED_RE.test(hay) && !hasReject) {
    return { verdict: 'received', reason: 'received', recruiting: true, pause: false };
  }
  if (NEXT_STEPS_RE.test(hay) && !hasReject) {
    return { verdict: 'not_reject', reason: 'next_steps', recruiting: true, pause: false };
  }

  if (hasReject && (fromAts || APPLICATION_RE.test(hay))) {
    return { verdict: 'reject', reason: 'template', recruiting: true, pause };
  }

  if (fromAts || APPLICATION_RE.test(subject) || APPLICATION_RE.test(hay)) {
    return { verdict: 'unsure', reason: 'recruiting_unclear', recruiting: true, pause };
  }

  if (MARKETING_RE.test(hay)) {
    return { verdict: 'noise', reason: 'marketing', recruiting: false, pause: false };
  }

  return { verdict: 'noise', reason: 'unrelated', recruiting: false, pause: false };
}

function mailBucket(cls) {
  const verdict = cls && cls.verdict;
  const reason = cls && cls.reason;
  if (!cls || verdict === 'noise') return 'noise';
  if (verdict === 'reject') return 'reject';
  if (verdict === 'received' || reason === 'received') return 'received';
  return 'other';
}

function planFiling(cls) {
  const bucket = mailBucket(cls);
  return {
    bucket,
    archive: bucket === 'reject' || bucket === 'received',
    notify: bucket === 'other',
  };
}

module.exports = { classifyRejection, mailBucket, planFiling, ATS_FROM, REJECT_RE, PAUSE_RE };
