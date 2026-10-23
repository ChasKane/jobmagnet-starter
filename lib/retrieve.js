const { wantsReuseRead } = require('./essay-prompt');
const { formatPrior, wantsPrior, searchAnswers, mentionedCompanies, namesFrom, loadAnswerRows } = require('./prior-drafts');

function namedUrls(text) {
  return (String(text || '').match(/https?:\/\/[^\s)]+/g) || []).slice(0, 4);
}

function wantsRetrieve(instruction, payload = {}) {
  const s = String(instruction || '');
  if (!s.trim()) return false;
  if (wantsReuseRead(s) || wantsPrior(s)) return true;
  if (/\b(use|incorporate|include|adapt)\b/i.test(s)) return true;
  if (namedUrls(s).length) return true;
  const fields = ((payload && payload.fields) || []).map((f) => f.label || '').join(' ');
  if (/\b(jm|jobmagnet|job magnet)\b/i.test(`${s} ${fields}`)) return true;
  return false;
}

function retrieveForDraft(payload = {}) {
  const instruction = String(payload.instruction || '');
  const urls = namedUrls(instruction);
  const { inferShape } = require('./cascade');
  const shape = inferShape(payload.fields, instruction);
  let named = [];
  try {
    const company = String(payload.company || '').trim();
    named = mentionedCompanies(
      [instruction, ...((payload.fields || []).map((f) => f.label || ''))].join(' '),
      namesFrom(loadAnswerRows(), []).filter((n) => n.toLowerCase() !== company.toLowerCase())
    );
  } catch (_) {
    named = [];
  }
  let prior = '';
  try {
    prior = formatPrior({ ...payload, shape }) || '';
  } catch (_) {
    prior = '';
  }
  let answers = [];
  try {
    answers = searchAnswers({
      similar_to: ((payload.fields || [])[0] && payload.fields[0].label) || '',
      shape,
      origins: named.length ? undefined : ['applicant', 'rewrite'],
      company: named[0] || '',
      limit: 2,
    });
  } catch (_) {
    answers = [];
  }
  let cards = [];
  try {
    const graph = require('./graph');
    graph.ensureOpen();
    const words = `${instruction} ${payload.company || ''} ${payload.title || ''} ${(payload.fields || [])
      .map((f) => f.label || '')
      .join(' ')}`
      .toLowerCase()
      .split(/[^a-z0-9+#]+/i)
      .filter((w) => w.length > 3);
    const index = graph.cardIndex() || [];
    cards = index
      .filter((c) => {
        const blob = `${c.employer || ''} ${c.claim || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
        return !words.length || words.some((w) => blob.includes(w));
      })
      .slice(0, 6);
  } catch (_) {
    cards = [];
  }
  const block = [
    prior,
    answers.length
      ? `Retrieved prior essays:\n${answers
          .map((d) => `(${d.company}) ${d.label}:\n${String(d.text || '').slice(0, 700)}`)
          .join('\n\n')}`
      : '',
    cards.length
      ? `Retrieved cards:\n${cards.map((c) => `${c.id} · ${c.employer}: ${c.claim}`).join('\n')}`
      : '',
    urls.length ? `Named URLs to fetch if needed: ${urls.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 8000);
  return {
    needed: true,
    prior,
    answers,
    cards,
    urls,
    shape,
    block,
  };
}

module.exports = { wantsRetrieve, retrieveForDraft, namedUrls };
