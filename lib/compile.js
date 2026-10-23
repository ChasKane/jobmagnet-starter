const graph = require('./graph');
const store = require('./store');
const { append } = require('./action-log');
const { skillEntries } = require('./profile-skills');
const { wantLlmCompile, llmProposeCards } = require('./compile-llm');
const { employerFromProducts, productFromText, productsInText } = require('./products');

const BIND_RE =
  /\b(use|prefer|should have used|would have used)\b[\s\S]{0,80}\b(pride|proud|why[- ]us|cover|conflict|ownership)\b/i;
const CARD_HINT_RE = /\b(jobmagnet|intern|auto-?filler|content graph)\b/i;

function escapeRe(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function employerFromText(text) {
  const body = String(text || '');
  if (!body.trim()) return '';
  const fromProduct = employerFromProducts(body);
  if (fromProduct) return fromProduct;
  graph.ensureOpen();
  const known = store.query('SELECT employer FROM timeline').map((r) => r.employer).filter(Boolean);
  const hits = known.filter((name) => {
    const token = String(name).split('/')[0].trim();
    if (token.length < 4) return false;
    return new RegExp(`\\b${escapeRe(token)}\\b`, 'i').test(body);
  });
  hits.sort((a, b) => b.length - a.length);
  return hits[0] || '';
}

function applicantQuoted(text, userText) {
  const body = String(text || '').trim();
  const hay = String(userText || '');
  if (!body || !hay) return false;
  const needle = body.slice(0, 48).toLowerCase();
  return hay.toLowerCase().includes(needle.slice(0, 24));
}

function inferTags(text) {
  const t = String(text || '').toLowerCase();
  const tags = [];
  if (/page builder|experiment|a\/b/.test(t)) tags.push('frontend', 'experiments');
  if (/ops platform|sql trigger|audit/.test(t)) tags.push('ops-platform', 'backend');
  if (/jobmagnet|autofill|apply browser|auto-filler|content graph/.test(t)) {
    tags.push('jobmagnet', 'frontend', 'forms', 'electron');
  }
  for (const product of productsInText(t)) tags.push(...(product.tags || []));
  if (/mentor|intern/.test(t)) tags.push('mentoring');
  if (/drag|overlay|iframe|embed/.test(t)) tags.push('embeds');
  if (/react/.test(t)) tags.push('react');
  return [...new Set(tags)];
}

function honestyFrom(text) {
  const t = String(text || '');
  const bits = [];
  if (/did not own|didn't own|not own/i.test(t)) bits.push(t.match(/[^.]*(did not own|didn't own|not own)[^.]*\.?/i)?.[0] || '');
  if (/no (user )?traffic|does not have .* numbers/i.test(t)) bits.push('No traffic numbers on file.');
  if (/advisor|assistant rather than teacher/i.test(t)) bits.push('Advisor, not teacher.');
  return bits.filter(Boolean).join(' ').trim();
}

function claimFrom(text) {
  const first = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=\.)\s+/)[0];
  return first.slice(0, 240);
}

function maybeBinding(userText) {
  const s = String(userText || '');
  if (!BIND_RE.test(s) && !/\b(pride|proud-project|proud project)\b/i.test(s)) return null;
  let shape = 'proud-project';
  if (/why[- ]us|why this/i.test(s)) shape = 'why-us';
  if (/conflict/i.test(s)) shape = 'conflict';
  if (/cover/i.test(s)) shape = 'cover';
  const hint = (s.match(CARD_HINT_RE) || [])[0];
  if (!hint) return { question_shape: shape, tag: null, card_id: null, source: 'assert' };
  const tag =
    /jobmagnet|auto-?filler|content graph/i.test(hint)
      ? 'jobmagnet'
      : /intern/i.test(hint)
        ? 'mentoring'
        : hint.toLowerCase();
  return { question_shape: shape, tag, source: 'assert' };
}

function gateRows(updates, ctx = {}) {
  const userText = ctx.userText || ctx.instruction || '';
  const source = ctx.source || 'chat';
  const allowUnquoted = Boolean(ctx.allowUnquoted);
  const rows = [];
  for (const u of Array.isArray(updates) ? updates : []) {
    const text = String((u && (u.text || u.bullets || u.add)) || '').trim();
    if (!text) continue;
    if (source !== 'final' && !allowUnquoted && !applicantQuoted(text, userText)) continue;
    rows.push({
      employer: String((u && (u.employer || u.company)) || '').trim(),
      text,
      final_id: u.final_id || null,
    });
  }
  return rows;
}

function heuristicCards(rows, ctx = {}) {
  const source = ctx.source || 'chat';
  const userText = ctx.userText || ctx.instruction || '';
  return rows.map((u) => ({
    employer: u.employer,
    claim: claimFrom(u.text),
    proof: u.text,
    honesty_bound: honestyFrom(u.text),
    tags: inferTags(u.text),
    people: [],
    question_shapes: [],
    links: [],
    final_id: u.final_id || null,
    confidence:
      ctx.forceExtracted || (source !== 'final' && !applicantQuoted(u.text, userText))
        ? 'extracted'
        : source === 'final' || applicantQuoted(u.text, userText)
          ? 'corroborated'
          : 'extracted',
  }));
}

function applyProposedCards(proposed, ctx = {}) {
  const source = ctx.source || 'chat';
  const requestId = ctx.requestId;
  const { result: patches, stmts } = store.transaction(() => {
    const out = [];
    const created = [];
    for (const row of proposed || []) {
      const employer = row.employer || employerFromText(row.proof || row.claim || '');
      const card = graph.upsertCard({
        employer,
        claim: row.claim || claimFrom(row.proof || ''),
        proof: row.proof || row.claim || '',
        honesty_bound: row.honesty_bound || honestyFrom(row.proof || ''),
        tags: row.tags && row.tags.length ? row.tags : inferTags(row.proof || row.claim || ''),
        people: row.people,
        question_shapes: row.question_shapes,
        confidence: row.confidence || (source === 'final' ? 'corroborated' : 'extracted'),
        source,
        final_id: row.final_id || null,
        createEmployer: source !== 'final',
      });
      if (card.kind !== 'no-op') {
        out.push(card);
        created.push({ patch: card, links: row.links || [] });
      }
    }
    for (const row of created) {
      const fromId = row.patch.card && row.patch.card.id;
      if (!fromId) continue;
      for (const link of row.links) {
        const needle = String(link.to_claim || '').toLowerCase();
        const emp = String(link.to_employer || '').toLowerCase();
        const hit = graph.cardIndex({ minConfidence: 'any' }).find((c) => {
          if (c.id === fromId) return false;
          const hay = `${c.employer} ${c.claim}`.toLowerCase();
          return (needle && hay.includes(needle.slice(0, 24))) || (emp && String(c.employer || '').toLowerCase() === emp);
        });
        if (hit) {
          const made = graph.addLink(fromId, hit.id, link.kind);
          if (made.kind !== 'no-op') out.push(made);
        }
      }
    }
    if (out.length) graph.addEvent('compile.patch', { patches: out, source }, requestId);
    return out;
  });
  if (patches.length) {
    append({
      request_id: requestId,
      kind: 'compile.patch',
      summary: `${patches.length} patch(es) from ${source}`,
      blobs: { patch: patches },
      extra: { store_tx: { stmts: stmts.length, rowCounts: stmts.map((s) => s.n) } },
    });
  }
  return patches;
}

async function compileUpdates(updates, ctx = {}) {
  graph.ensureOpen();
  const source = ctx.source || 'chat';
  const rows = gateRows(updates, ctx);
  if (!rows.length) return [];
  let proposed = heuristicCards(rows, ctx);
  if (wantLlmCompile(ctx)) {
    try {
      const llmCards = await llmProposeCards(rows, {
        employers: graph.listTimeline().map((r) => r.employer).filter(Boolean),
        existingTags: graph.listTags(),
      });
      if (llmCards.length) {
        proposed = llmCards.map((c, i) => ({
          ...c,
          employer: c.employer || rows[i] && rows[i].employer,
          final_id: (rows[i] && rows[i].final_id) || c.final_id,
          confidence: ctx.forceExtracted ? 'extracted' : source === 'final' ? 'corroborated' : 'extracted',
        }));
      }
    } catch (err) {
      console.warn('[magnet] compile llm:', (err && err.message) || err);
    }
  }
  return applyProposedCards(proposed, ctx);
}

function applyExperienceUpdates(updates, ctx = {}) {
  return compileUpdates(updates, ctx);
}

function sourceCardIds(row) {
  const raw = (row && (row.source_card_ids || row.source_ids)) || [];
  return (Array.isArray(raw) ? raw : []).map(String).filter(Boolean);
}

function looksLikeWorkStory(text) {
  const body = String(text || '');
  if (productFromText(body) || employerFromText(body)) return true;
  return /\b(built|shipped|converted|implemented|wrote|drafted|autofill|graph|platform|review panel)\b/i.test(body);
}

function cardsMatchingText(text) {
  graph.ensureOpen();
  const product = productFromText(text);
  const index = graph.cardIndex({ minConfidence: 'any' });
  if (product) {
    const tagged = index.filter(
      (c) =>
        (c.tags || []).includes(product.id) ||
        (c.employer === product.employer && (c.tags || []).some((t) => product.tags.includes(t)))
    );
    if (tagged.length) return tagged.map((c) => c.id);
  }
  return [];
}

function patchSourceCards(ids, text, finalId) {
  const bodies = graph.cardBodies(ids);
  const out = [];
  for (const card of bodies) {
    const result = graph.upsertCard({
      employer: card.employer,
      claim: card.claim,
      proof: text,
      honesty_bound: card.honesty_bound,
      tags: [...(card.tags || []), ...inferTags(text)],
      source: 'final',
      final_id: finalId,
      createEmployer: false,
    });
    if (result.kind !== 'no-op') out.push(result);
  }
  return out;
}

async function compileFinals(rows, ctx = {}) {
  const allowed = (rows || []).filter((r) => {
    const origin = r.origin || '';
    if (origin === 'magnet') return false;
    const text = String(r.final || '').trim();
    return text.length >= 80 && /applicant|rewrite|edit/.test(origin);
  });
  const patches = [];
  const updates = [];
  for (const r of allowed) {
    const text = String(r.final || '').trim();
    const finalId = `${r.ts || ''}:${r.label || ''}`;
    const ids = sourceCardIds(r);
    const matches = ids.length ? ids : cardsMatchingText(text);
    if (matches.length) {
      patches.push(...patchSourceCards(matches, text, finalId));
      continue;
    }
    if (!looksLikeWorkStory(text)) continue;
    updates.push({
      employer: employerFromText(text) || '',
      text,
      final_id: finalId,
    });
  }
  const created = await compileUpdates(updates, { ...ctx, source: 'final', allowUnquoted: true });
  return [...patches, ...created];
}

function resetFinalCards() {
  graph.ensureOpen();
  const rows = store.query("SELECT id FROM cards WHERE source = 'final'");
  for (const row of rows) graph.deleteCard(row.id);
}

function repairOrphanApplyEmployers(profile) {
  graph.ensureOpen();
  resetFinalCards();
  const allowed = new Set(((profile && profile.employment) || []).map((j) => String(j.employer || '').trim().toLowerCase()));
  for (const row of graph.listTimeline()) {
    const name = String(row.employer || '').trim().toLowerCase();
    if (allowed.has(name)) continue;
    if (String(row.title || '').trim()) continue;
    graph.deleteTimeline(row.id);
  }
}

function skillYearsCard(profile) {
  const entries = skillEntries(profile).filter((s) => s && s.years != null);
  const lines = entries.map((s) => {
    const since = s.since ? ` since ${s.since}` : '';
    return `${s.id}: ${s.years} years${since}`;
  });
  const zeros = entries.filter((s) => s.years === 0).map((s) => s.id);
  return {
    id: 'card_skill_years',
    claim: lines.length ? `${lines.join('. ')}.` : 'No skill years on file.',
    claim_shape: 'skill_years_production',
    proof: lines.join('\n'),
    honesty_bound: zeros.length ? `Do not invent ${zeros.join(', ')}.` : '',
    tags: entries.map((s) => s.id).filter(Boolean).slice(0, 12),
    confidence: 'corroborated',
    source: 'profile',
    createEmployer: false,
  };
}

function seedSkillYears() {
  graph.ensureOpen();
  const card = skillYearsCard();
  const existing = store.queryOne('SELECT * FROM cards WHERE id = ? OR claim_shape = ?', [card.id, card.claim_shape]);
  if (existing) {
    store.exec(
      'UPDATE cards SET claim = ?, proof = ?, honesty_bound = ?, confidence = ?, source = ? WHERE id = ?',
      [card.claim, card.proof, card.honesty_bound, card.confidence, card.source, existing.id]
    );
    store.exec('DELETE FROM card_tags WHERE card_id = ?', [existing.id]);
    for (const tag of card.tags || []) {
      store.exec('INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)', [existing.id, tag]);
    }
    return { kind: 'merge', card: { id: existing.id, claim: card.claim } };
  }
  return graph.upsertCard(card);
}

function restoreVoiceFromFile(text) {
  const body = String(text || '').trim();
  if (!body) return null;
  const cur = graph.currentVoice();
  if (!cur) return graph.seedVoiceFromFile(body);
  if (cur.text.trim() === body) return cur;
  if (cur.text.trim().length < 80 || /^Be specific\. No career tour/.test(cur.text.trim())) {
    return graph.addVoiceVersion({ kind: 'user', text: body, parent_id: cur.id });
  }
  return cur;
}

function seedTimelineFromProfile(profile) {
  graph.ensureOpen();
  const jobs = (profile && profile.employment) || [];
  const stubs = [];
  for (const job of jobs) {
    const tid = graph.upsertTimeline(job);
    const bullets = String(job.bullets || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const b of bullets) {
      const stub = graph.addStub(tid, b, 'resume');
      if (stub) stubs.push(stub);
    }
  }
  return stubs;
}

function magnetWouldWrite(updates, userText) {
  return (updates || []).filter((u) => {
    const text = String((u && u.text) || '').trim();
    return text && !applicantQuoted(text, userText);
  });
}

async function parkExtracted(updates, ctx = {}) {
  const rows = magnetWouldWrite(updates, ctx.userText || ctx.instruction || '');
  if (!rows.length) return [];
  const patches = await compileUpdates(rows, {
    ...ctx,
    source: ctx.source || 'chat',
    allowUnquoted: true,
    forceExtracted: true,
  });
  return rows.map((u, i) => {
    const card = (patches[i] && patches[i].card) || (patches[0] && patches[0].card) || null;
    return {
      employer: String((u && u.employer) || '').trim(),
      text: String((u && u.text) || '').trim(),
      parked: true,
      card_id: card && card.id,
    };
  });
}

function confirmExtracted(cardId) {
  graph.ensureOpen();
  return graph.setCardConfidence(cardId, 'corroborated');
}

module.exports = {
  applyExperienceUpdates,
  compileUpdates,
  compileFinals,
  seedTimelineFromProfile,
  applicantQuoted,
  inferTags,
  maybeBinding,
  magnetWouldWrite,
  parkExtracted,
  confirmExtracted,
  employerFromText,
  resetFinalCards,
  repairOrphanApplyEmployers,
  seedSkillYears,
  skillYearsCard,
  restoreVoiceFromFile,
  store,
};
