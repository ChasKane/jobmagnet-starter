const fs = require('fs');
const path = require('path');
const { listChats } = require('./tab-chat');
const { withRank } = require('./answer-rank');

const ANSWERS = path.join(__dirname, '..', 'knowledge', 'archive', 'answers.jsonl');
const EEO_LABEL_RE =
  /gender|racial|ethnic|sexual orientation|veteran|disability|hispanic|transgender/i;

function escapeRe(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MACHINE_ORIGINS = new Set(['autofill', 'harvest', 'profile', 'agent']);

function loadAnswerRows() {
  try {
    const { loadLoggedEssays } = require('./essay-log');
    return loadLoggedEssays()
      .filter((row) => row && String(row.final || row.llm_draft || '').trim().length >= 40)
      .filter((row) => !EEO_LABEL_RE.test(row.label || ''))
      .filter((row) => !MACHINE_ORIGINS.has(String(row.origin || '')))
      .map(withRank);
  } catch (_) {
    return [];
  }
}

function stemQuestion(label, companies) {
  let s = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9+/#\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const c of companies) {
    const name = String(c || '').trim();
    if (name.length < 3) continue;
    s = s.replace(new RegExp(`\\b${escapeRe(name)}\\b`, 'gi'), ' ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

function namesFrom(rows, chats) {
  const names = new Set();
  for (const row of rows) {
    if (row.company) names.add(String(row.company).trim());
  }
  for (const chat of chats) {
    if (chat.company) names.add(String(chat.company).trim());
  }
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length);
}

function mentionedCompanies(text, names) {
  const src = String(text || '');
  if (!src) return [];
  const hit = [];
  for (const name of names) {
    if (name.length < 4) continue;
    if (new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(src)) hit.push(name);
  }
  return hit;
}

function wantsPrior(instruction) {
  const s = String(instruction || '');
  if (!s) return false;
  if (
    /\b(previous|prev|last|other|earlier|past)\b.{0,48}\b(draft|application|essay|chat|one|cover|letter|answer)\b/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\b(I wrote|i wrote|my version|my answer|what I wrote|what i wrote)\b/i.test(s)) return true;
  return /\b(reuse|adapt|same as|like the|from the|use the)\b/i.test(s);
}

function packRow(row) {
  return {
    company: String(row.company || '').trim(),
    label: String(row.label || row.normalized_key || 'essay').trim(),
    text: String(row.final || row.llm_draft || '').trim(),
    ts: row.ts || '',
    url: row.url || '',
    origin: row.origin,
    score: row.score || 0,
  };
}

function latestByCompany(rows) {
  const by = new Map();
  for (const row of rows) {
    const d = packRow(row);
    if (!d.company || !d.text) continue;
    const key = `${d.company}::${d.label.toLowerCase()}`;
    const prev = by.get(key);
    if (!prev) {
      by.set(key, d);
      continue;
    }
    if (d.score > prev.score + 8) {
      by.set(key, d);
      continue;
    }
    if (prev.score > d.score + 8) continue;
    if (String(d.ts) >= String(prev.ts)) by.set(key, d);
  }
  return [...by.values()];
}

function similarDrafts(fields, company, drafts) {
  const companies = namesFrom(
    drafts.map((d) => ({ company: d.company })),
    []
  );
  const stems = (fields || [])
    .map((f) => stemQuestion(f.label || '', [company, ...companies]))
    .filter((s) => s.length >= 12);
  if (!stems.length) return [];
  const picked = [];
  const seen = new Set();
  const ranked = [...drafts].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const d of ranked) {
    if (d.company === company) continue;
    const stem = stemQuestion(d.label, [d.company, company, ...companies]);
    if (stem.length < 12) continue;
    const match = stems.some((s) => s === stem || (s.length >= 18 && (s.includes(stem) || stem.includes(s))));
    if (!match) continue;
    const key = `${d.company}::${stem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(d);
    if (picked.length >= 5) break;
  }
  return picked;
}

function chatNotes(chats, excludeUrl, named) {
  const notes = [];
  const namedSet = new Set((named || []).map((n) => n.toLowerCase()));
  const others = chats.filter((c) => c.url && c.url !== excludeUrl);
  others.sort((a, b) => {
    const an = namedSet.has(String(a.company || '').toLowerCase()) ? 0 : 1;
    const bn = namedSet.has(String(b.company || '').toLowerCase()) ? 0 : 1;
    return an - bn;
  });
  for (const chat of others) {
    for (const m of chat.messages || []) {
      if (m.role !== 'you') continue;
      const text = String(m.text || '').trim();
      if (text.length < 12) continue;
      notes.push({ company: chat.company || 'other', text: text.slice(0, 500) });
      if (notes.length >= 12) return notes;
    }
  }
  return notes;
}

function namedDrafts(drafts, company, named) {
  if (!named.length) return [];
  const want = new Set(named.map((n) => n.toLowerCase()));
  return drafts
    .filter((d) => d.company !== company && want.has(d.company.toLowerCase()))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function personalDrafts(drafts, company) {
  return drafts
    .filter(
      (d) =>
        d.company !== company &&
        (d.origin === 'applicant' || d.origin === 'rewrite' || (d.score || 0) >= 50)
    )
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 4);
}

function shapeOfLabel(label, instruction) {
  const { inferShape } = require('./cascade');
  return inferShape([{ label: label || '' }], instruction || '');
}

function isPersonalOrigin(origin) {
  return origin === 'applicant' || origin === 'rewrite';
}

function draftsForShape(drafts, { shape, company, limit = 2 } = {}) {
  const want = String(shape || '').trim() || 'general';
  return (drafts || [])
    .filter((d) => {
      if (company && d.company === company) return false;
      if (!isPersonalOrigin(d.origin)) return false;
      return shapeOfLabel(d.label) === want;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

function stripNames(text, names) {
  let s = String(text || '');
  for (const name of names || []) {
    const token = String(name || '').trim();
    if (token.length < 3) continue;
    s = s.replace(new RegExp(`\\b${escapeRe(token)}\\b`, 'gi'), 'that company');
  }
  return s.replace(/\s+/g, ' ').trim();
}

function bestPriorForShape(payload = {}, deps = {}) {
  const fields = payload.fields || [];
  const shape =
    payload.shape ||
    shapeOfLabel(fields.map((f) => f.label || '').join(' '), payload.instruction);
  const company = String(payload.company || '').trim();
  const rows = deps.rows || loadAnswerRows();
  const drafts = latestByCompany(rows);
  const hit = draftsForShape(drafts, { shape, company, limit: 1 })[0];
  if (!hit) return null;
  const names = namesFrom(rows, []).concat(company).filter(Boolean);
  return {
    ...hit,
    shape,
    rubric: stripNames(hit.text, names),
  };
}

function originLabel(origin) {
  if (origin === 'applicant') return 'applicant-written, Magnet never drafted';
  if (origin === 'rewrite') return 'applicant rewrite, far from Magnet draft';
  if (origin === 'edit') return 'applicant edit';
  return 'Magnet draft the applicant kept';
}

function catalogCompanies(drafts, company) {
  const catalog = [];
  const seenCo = new Set();
  for (const d of [...drafts].sort((a, b) => String(b.ts).localeCompare(String(a.ts)))) {
    if (d.company === company || seenCo.has(d.company)) continue;
    seenCo.add(d.company);
    const labels = drafts
      .filter((x) => x.company === d.company)
      .map((x) => x.label)
      .filter(Boolean)
      .slice(0, 4);
    catalog.push(`${d.company}${labels.length ? ` (${labels.join('; ')})` : ''}`);
    if (catalog.length >= 12) break;
  }
  return catalog;
}

function searchAnswerRows(rows, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 3, 1), 8);
  const company = String(opts.company || '').trim().toLowerCase();
  const query = String(opts.query || '').trim().toLowerCase();
  const similarTo = String(opts.similar_to || opts.similarTo || '').trim();
  const origins = Array.isArray(opts.origins) ? opts.origins.map(String) : null;
  const shape = String(opts.shape || '').trim();
  let pool = (rows || []).map(packRow).filter((d) => d.text);
  if (origins) pool = pool.filter((d) => origins.includes(d.origin));
  if (shape) pool = pool.filter((d) => shapeOfLabel(d.label) === shape);
  if (company) pool = pool.filter((d) => d.company.toLowerCase() === company);
  if (similarTo) {
    const companies = namesFrom(
      pool.map((d) => ({ company: d.company })),
      []
    );
    const stem = stemQuestion(similarTo, companies);
    if (stem.length >= 8) {
      const ranked = pool
        .map((d) => {
          const other = stemQuestion(d.label, [d.company, ...companies]);
          const hit =
            other &&
            (other === stem ||
              (stem.length >= 12 && other.length >= 12 && (other.includes(stem) || stem.includes(other))));
          return { d, hit };
        })
        .filter((x) => x.hit)
        .map((x) => x.d);
      if (ranked.length) pool = ranked;
    }
  }
  if (query) {
    pool = pool.filter((d) => `${d.company} ${d.label} ${d.text}`.toLowerCase().includes(query));
  }
  pool.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return String(b.ts).localeCompare(String(a.ts));
  });
  return pool.slice(0, limit);
}

function searchAnswers(opts = {}) {
  return searchAnswerRows(loadAnswerRows(), opts);
}

function formatPriorCatalog(payload, deps = {}) {
  const company = String(payload.company || '').trim();
  const drafts = payload._drafts || latestByCompany(deps.rows || loadAnswerRows());
  const names = catalogCompanies(drafts, company);
  if (!names.length) return '';
  return `Prior application drafts on file (name a company to reuse one, or say "use what I wrote"): ${names.join('; ')}.`;
}

function formatPrior(payload, deps = {}) {
  const company = String(payload.company || '').trim();
  const instruction = String(payload.instruction || '').trim();
  const fields = payload.fields || [];
  const rows = deps.rows || loadAnswerRows();
  const chats = deps.chats != null ? deps.chats : listChats();
  const allNames = namesFrom(rows, chats);
  const drafts = latestByCompany(rows);
  const shape =
    payload.shape || shapeOfLabel(fields.map((f) => f.label || '').join(' '), instruction);
  const named = mentionedCompanies(
    [instruction, ...fields.map((f) => f.label || '')].join(' '),
    allNames.filter((n) => n.toLowerCase() !== company.toLowerCase())
  );
  const pull = wantsPrior(instruction) || named.length > 0;
  const parts = [formatPriorCatalog({ ...payload, _drafts: drafts })].filter(Boolean);

  const shaped = draftsForShape(drafts, { shape, company, limit: 2 });
  if (shaped.length) {
    parts.push(
      `Applicant/rewrite answers of this shape (${shape}). Adapt company-specific claims for this role; Magnet-kept drafts are not evidence:\n${shaped
        .map((d) => `(${d.company} · ${originLabel(d.origin)}) ${d.label}:\n${d.text.slice(0, 900)}`)
        .join('\n\n')}`
    );
  }

  const notes = chatNotes(chats, payload.url || '', named).slice(0, 6);
  if (notes.length) {
    parts.push(
      `Notes from other job chats (scratch; not evidence until filed):\n${notes
        .map((n) => `(${n.company}) ${n.text}`)
        .join('\n')}`
    );
  }

  if (!pull) return parts.join('\n\n').slice(0, 4000);

  const full = [];
  const seenText = new Set();
  const add = (list) => {
    for (const d of list) {
      const key = `${d.company}::${d.label}::${d.text.slice(0, 80)}`;
      if (seenText.has(key)) continue;
      seenText.add(key);
      full.push(d);
    }
  };
  add(namedDrafts(drafts, company, named));
  add(similarDrafts(fields, company, drafts));
  if (full.length) {
    parts.push(
      `Matching or requested prior drafts. Prefer applicant/rewrite rows. Rewrite company-specific claims for this role:\n${full
        .slice(0, 5)
        .map((d) => `(${d.company} · ${originLabel(d.origin)}) ${d.label}:\n${d.text.slice(0, 900)}`)
        .join('\n\n')}`
    );
  }
  return parts.join('\n\n').slice(0, 4000);
}

module.exports = {
  formatPrior,
  formatPriorCatalog,
  searchAnswers,
  searchAnswerRows,
  stemQuestion,
  wantsPrior,
  loadAnswerRows,
  chatNotes,
  personalDrafts,
  draftsForShape,
  shapeOfLabel,
  bestPriorForShape,
  stripNames,
  isPersonalOrigin,
  mentionedCompanies,
  namesFrom,
};
