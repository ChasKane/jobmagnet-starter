function hasProperNoun(text) {
  const body = String(text || '');
  const midSentence = body.replace(/(^|[.!?]\s+)[A-Z][a-z]{2,}\b/g, '$1');
  return /\b[A-Z][a-z]{2,}\b/.test(midSentence) || /\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/.test(body);
}

function nounStripped(text) {
  if (!hasProperNoun(text)) return String(text || '').trim();
  return String(text || '')
    .replace(/\b[A-Z][a-z]{2,}\b/g, 'that work')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULES = [
  {
    id: 'no_career_tour',
    text: 'Do not open with a multi-employer career tour. One or two named jobs is enough.',
    re: /career tour|three employer|walked (the )?(resume|employment)|résumé tour|resume tour/i,
  },
  {
    id: 'no_rule_of_three',
    text: 'Do not force a tidy rule-of-three or parallel stack. Uneven length is correct.',
    re: /rule of 3|rule of three|parallel stack|three bullets|tidy parallel/i,
  },
  {
    id: 'ownership_bound',
    text: 'State ownership bounds when the work could be overclaimed (built vs owned outcomes).',
    re: /ownership|didn'?t own|not my lane|readouts|overclaim/i,
  },
  {
    id: 'cut_tour_length',
    text: 'Prefer a short, specific answer over a long résumé-shaped paragraph.',
    re: /too long|shorten|cut the tour|collapse/i,
  },
  {
    id: 'closer_negates_thin_layer',
    text: 'When positioning scope, a negative closer is allowed (not a thin or peripheral layer) without naming a product.',
    re: /thin layer|peripheral|not a bolt/i,
  },
  {
    id: 'jd_echo',
    text: 'Echo the posting’s phrasing when it helps credibility; do not paraphrase into generic enthusiasm.',
    re: /quote the jd|jd phrasing|your jd describes/i,
  },
];

function extractVoiceRules({ draft, final, note } = {}) {
  const blob = [note, draft, final].filter(Boolean).join('\n');
  const hits = [];
  for (const rule of RULES) {
    if (rule.re.test(blob)) hits.push({ id: rule.id, text: rule.text });
  }
  return hits;
}

function isEligibleFinal(row) {
  const origin = row && row.origin;
  if (origin === 'magnet' || origin === 'empty') return false;
  const label = String((row && row.label) || '');
  if (/gender|racial|ethnic|veteran|disability|hispanic|transgender/i.test(label)) return false;
  const text = String((row && row.final) || '').trim();
  if (text.length < 40) return false;
  return origin === 'applicant' || origin === 'rewrite' || origin === 'edit';
}

function applyRulesToVoice(current, rules) {
  const body = String(current || '').trim();
  const lines = rules.map((r) => nounStripped(r.text)).filter((t) => t && !hasProperNoun(t));
  if (!lines.length) return body;
  const have = new Set(
    body
      .split('\n')
      .map((l) => l.replace(/^- /, '').trim().toLowerCase())
      .filter(Boolean)
  );
  const add = [];
  for (const line of lines) {
    if (have.has(line.toLowerCase())) continue;
    add.push(`- ${line}`);
  }
  if (!add.length) return body;
  const header = body.includes('## Learned') ? body : `${body}\n\n## Learned\n`;
  return `${header.trim()}\n${add.join('\n')}\n`.trim() + '\n';
}

module.exports = {
  RULES,
  nounStripped,
  hasProperNoun,
  extractVoiceRules,
  isEligibleFinal,
  applyRulesToVoice,
};
