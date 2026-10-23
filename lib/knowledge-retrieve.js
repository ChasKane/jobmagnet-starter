const { load } = require('./profile-facts');
const { skillYearsCard } = require('./compile');

function tokens(s) {
  return new Set(String(s || '').toLowerCase().match(/[a-z][a-z0-9+]{2,}/g) || []);
}

const GENERIC = new Set(
  `the and for with from that this have been they them their you your
   software engineer engineering frontend backend web app application
   react javascript typescript code team product design experience work
   role job company senior staff used using also into when were what
   which not did does than then over one two via state management
   managers corporate`
    .trim()
    .split(/\s+/)
    .filter(Boolean)
);

function overlap(chunkText, queryTokens) {
  if (!queryTokens.size) return 0;
  let n = 0;
  for (const t of tokens(chunkText)) {
    if (queryTokens.has(t)) n += 1;
  }
  return n;
}

function distinctiveOverlap(chunkText, queryTokens) {
  if (!queryTokens.size) return 0;
  let n = 0;
  for (const t of tokens(chunkText)) {
    if (GENERIC.has(t) || t.length < 4) continue;
    if (queryTokens.has(t)) n += 1;
  }
  return n;
}

function topicBoost(chunkText, query) {
  const q = String(query || '').toLowerCase();
  const c = String(chunkText || '').toLowerCase();
  const pairs = [
    [/mentor|intern|coach|teach|advis/, /mentor|intern|coach|teach|advis/],
    [/experiment|a\/b|ab test/, /experiment|a\/b|ab test/],
    [
      /anything more|additional info|interests|why (this|the) (role|company)|tell us about you/,
      /spreadsheet|ops platform|auto-filler|sql trigger|form state/,
    ],
    [/frontend|react|css|design system|product (taste|sensibilit)/, /frontend|react|css|design system|component|overlay/],
    [/\byears|yoe|stack|svelte|vue|angular|next\.?js|node\b/, /years|svelte|vue|angular|next|node|javascript|typescript/],
  ];
  let n = 0;
  for (const [qRe, cRe] of pairs) {
    if (qRe.test(q) && cRe.test(c)) n += 4;
  }
  return n;
}

function pushChunk(chunks, title, text, extra = {}) {
  const body = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return;
  chunks.push({ title, text: body.slice(0, 900), ...extra });
}

function identityChunk(profile) {
  const id = (profile && profile.identity) || {};
  const work = (profile && profile.work) || {};
  const pay = (work.compensation && work.compensation.target_usd) || '';
  const based = [id.based_city, id.based_state].filter(Boolean).join(', ');
  const tz = id.based_timezone ? `${id.based_timezone} timezone` : '';
  return [
    id.preferred_name || id.legal_name,
    based,
    tz,
    id.email,
    work.remote ? 'remote' : '',
    pay ? `target $${pay}` : '',
    work.legally_authorized_to_work_us ? 'US work authorized, no sponsorship' : '',
  ]
    .filter(Boolean)
    .join('. ');
}

function cardText(card) {
  return [card.claim, card.proof, card.honesty_bound ? `Bound: ${card.honesty_bound}` : '']
    .filter(Boolean)
    .join('\n');
}

function loadChunks() {
  const chunks = [];
  let profile = {};
  try {
    profile = load() || {};
  } catch (_) {}

  pushChunk(chunks, 'Identity', identityChunk(profile), { always: true });

  const years = skillYearsCard(profile);
  pushChunk(chunks, 'Skill years', cardText(years), { always: true, kind: 'card', id: years.id });

  try {
    const graph = require('./graph');
    graph.ensureOpen();
    for (const card of graph.allCardBodies({ minConfidence: 'any' }) || []) {
      if (card.id === years.id || card.claim_shape === years.claim_shape) continue;
      pushChunk(chunks, `${card.id} ${(card.employer || '').trim()}`.trim(), cardText(card), {
        kind: 'card',
        id: card.id,
      });
    }
  } catch (_) {}

  try {
    const { loadExperienceNotes } = require('./employment');
    for (const note of loadExperienceNotes() || []) {
      pushChunk(chunks, `Work note: ${note.employer || ''}`, note.text, { kind: 'note' });
    }
  } catch (_) {}

  return chunks;
}

function retrieveKnowledge(query, opts = {}) {
  const maxChars = opts.maxChars || 2400;
  const q = tokens(query);
  const noteQuery = opts.noteQuery != null ? opts.noteQuery : query;
  const noteTokens = tokens(noteQuery);
  const chunks = loadChunks();
  const always = chunks.filter((c) => c.always);
  const rest = chunks
    .filter((c) => !c.always)
    .map((c) => {
      if (c.kind === 'note') {
        const score = distinctiveOverlap(c.text, noteTokens) + topicBoost(c.text, noteQuery);
        return { ...c, score };
      }
      return { ...c, score: overlap(`${c.title} ${c.text}`, q) + topicBoost(c.text, query) };
    })
    .sort((a, b) => b.score - a.score);

  const picked = [...always];
  let used = picked.reduce((n, c) => n + c.text.length, 0);
  let notesUsed = 0;
  const scored = rest.filter((c) => c.score > 0);
  const pool = scored.length ? scored : rest.filter((c) => c.kind !== 'note').slice(0, 4);
  for (const c of pool) {
    if (c.kind === 'note') {
      if (c.score < 2 || notesUsed >= 2) continue;
      notesUsed += 1;
    }
    if (used + c.text.length > maxChars) continue;
    picked.push(c);
    used += c.text.length;
    if (picked.length >= 8) break;
  }
  return picked.map((c) => `### ${c.title}\n${c.text}`).join('\n\n');
}

module.exports = { retrieveKnowledge };
