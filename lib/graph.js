const crypto = require('crypto');
const storeApi = require('./store/api');

const store = new Proxy(
  {},
  {
    get(_t, prop) {
      const impl = storeApi.getDriver() ? storeApi : require('./store');
      const val = impl[prop];
      return typeof val === 'function' ? val.bind(impl) : val;
    },
  }
);

function now() {
  return new Date().toISOString();
}

function id(prefix, extra) {
  const h = crypto.createHash('sha1').update(String(extra || '') + Math.random()).digest('hex').slice(0, 12);
  return `${prefix}_${h}`;
}

function claimShape(claim, employer) {
  const raw = `${String(employer || '').toLowerCase()} ${String(claim || '').toLowerCase()}`
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .join('_');
  return raw || 'claim';
}

function ensureOpen() {
  if (storeApi.getDriver()) return;
  require('./store').open();
}

function timelineId(employer) {
  const name = String(employer || '').trim();
  if (!name) return '';
  const row = store.queryOne('SELECT id FROM timeline WHERE lower(employer) = lower(?)', [name]);
  if (row) return row.id;
  const tid = id('tl', name);
  store.exec(
    'INSERT INTO timeline (id, employer, title, start, end, location, current) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [tid, name, '', '', '', '']
  );
  return tid;
}

function upsertTimeline(job) {
  ensureOpen();
  const name = String((job && job.employer) || '').trim();
  if (!name) return '';
  const existing = store
    .query('SELECT id, start FROM timeline WHERE lower(employer) = lower(?)', [name])
    .find((row) => String(row.start || '') === String(job.start || ''));
  if (existing) {
    store.exec(
      'UPDATE timeline SET title = ?, end = ?, location = ?, current = ? WHERE id = ?',
      [job.title || '', job.end || '', job.location || '', job.current ? 1 : 0, existing.id]
    );
    return existing.id;
  }
  const tid = id('tl', `${name}${job.start || ''}`);
  store.exec(
    'INSERT INTO timeline (id, employer, title, start, end, location, current) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [tid, name, job.title || '', job.start || '', job.end || '', job.location || '', job.current ? 1 : 0]
  );
  return tid;
}

function addStub(timelineId, text, source) {
  const body = String(text || '').trim();
  if (!timelineId || !body) return null;
  const dup = store.queryOne('SELECT id FROM stubs WHERE timeline_id = ? AND text = ?', [timelineId, body]);
  if (dup) return dup;
  const sid = id('stub', body);
  store.exec(
    'INSERT INTO stubs (id, timeline_id, text, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sid, timelineId, body, 'unverified', source || 'resume', now()]
  );
  return { id: sid, timeline_id: timelineId, text: body };
}

function findCard(employerId, shape) {
  return store.queryOne('SELECT * FROM cards WHERE employer_id = ? AND claim_shape = ?', [employerId, shape]);
}

function setTags(cardId, tags) {
  const list = [...new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  store.exec('DELETE FROM card_tags WHERE card_id = ?', [cardId]);
  for (const tag of list) {
    store.exec('INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)', [cardId, tag]);
  }
}

function setPeople(cardId, people) {
  store.exec('DELETE FROM card_people WHERE card_id = ?', [cardId]);
  for (const p of people || []) {
    const name = String((p && p.name) || '').trim();
    if (!name) continue;
    store.exec('INSERT OR IGNORE INTO card_people (card_id, name, relation) VALUES (?, ?, ?)', [
      cardId,
      name,
      String((p && p.relation) || '').trim(),
    ]);
  }
}

function setShapes(cardId, shapes) {
  store.exec('DELETE FROM card_shapes WHERE card_id = ?', [cardId]);
  for (const shape of shapes || []) {
    const s = String(shape || '')
      .trim()
      .toLowerCase();
    if (!s) continue;
    store.exec('INSERT OR IGNORE INTO card_shapes (card_id, shape) VALUES (?, ?)', [cardId, s]);
  }
}

function addLink(fromId, toId, kind) {
  if (!fromId || !toId || fromId === toId) return { kind: 'no-op' };
  store.exec('INSERT OR IGNORE INTO card_links (from_id, to_id, kind) VALUES (?, ?, ?)', [
    fromId,
    toId,
    String(kind || 'related').trim() || 'related',
  ]);
  return { kind: 'link', from_id: fromId, to_id: toId };
}

function listTags() {
  ensureOpen();
  return store.query('SELECT DISTINCT tag FROM card_tags ORDER BY tag').map((r) => r.tag).filter(Boolean);
}

function indexForTags(tags) {
  const index = cardIndex({ minConfidence: 'corroborated' });
  const want = new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean));
  if (!want.size) return index;
  const hit = index.filter((c) => (c.tags || []).some((t) => want.has(t)));
  return hit.length ? hit : index;
}

function listTimeline() {
  ensureOpen();
  return store.query('SELECT * FROM timeline');
}

function findTimelineByEmployer(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const rows = listTimeline();
  const exact = rows.find((r) => String(r.employer || '').toLowerCase() === n);
  if (exact) return exact;
  const token = n.split('/')[0].trim();
  return (
    rows.find((r) => {
      const emp = String(r.employer || '').toLowerCase();
      const head = emp.split('/')[0].trim();
      return (token && (emp.includes(token) || token.includes(head))) || (head && n.includes(head));
    }) || null
  );
}

function resolveEmployerId(employer, { create = true } = {}) {
  const name = String(employer || '').trim();
  if (!name) return '';
  const hit = findTimelineByEmployer(name);
  if (hit) return hit.id;
  if (!create) return '';
  return timelineId(name);
}

function deleteTimeline(id) {
  if (!id) return;
  store.exec('DELETE FROM stubs WHERE timeline_id = ?', [id]);
  const cards = store.query('SELECT id FROM cards WHERE employer_id = ?', [id]);
  for (const c of cards) deleteCard(c.id);
  store.exec('DELETE FROM timeline WHERE id = ?', [id]);
}

function deleteCard(id) {
  if (!id) return;
  store.exec('DELETE FROM card_tags WHERE card_id = ?', [id]);
  store.exec('DELETE FROM card_people WHERE card_id = ?', [id]);
  store.exec('DELETE FROM card_shapes WHERE card_id = ?', [id]);
  store.exec('DELETE FROM card_links WHERE from_id = ? OR to_id = ?', [id, id]);
  store.exec('DELETE FROM cards WHERE id = ?', [id]);
}

function upsertCard(input) {
  ensureOpen();
  const claim = String((input && input.claim) || '').trim();
  if (!claim) return { kind: 'no-op' };
  const employer = String((input && input.employer) || '').trim();
  const employerId = input.employer_id || resolveEmployerId(employer, { create: input.createEmployer !== false });
  const shape = input.claim_shape || claimShape(claim, employer);
  const existing = employerId ? findCard(employerId, shape) : store.queryOne('SELECT * FROM cards WHERE claim_shape = ?', [shape]);
  if (existing) {
    const nextBound = input.honesty_bound || existing.honesty_bound;
    const nextProof = [existing.proof, input.proof].filter(Boolean).join('\n').slice(0, 2000);
    store.exec(
      'UPDATE cards SET proof = ?, honesty_bound = ?, confidence = ?, final_id = coalesce(?, final_id) WHERE id = ?',
      [
        nextProof,
        nextBound,
        input.confidence || existing.confidence || 'corroborated',
        input.final_id || null,
        existing.id,
      ]
    );
    if (input.tags) {
      const have = store.query('SELECT tag FROM card_tags WHERE card_id = ?', [existing.id]).map((r) => r.tag);
      setTags(existing.id, [...have, ...input.tags]);
    }
    if (input.people) {
      const have = store.query('SELECT name, relation FROM card_people WHERE card_id = ?', [existing.id]);
      setPeople(existing.id, [...have, ...input.people]);
    }
    if (input.question_shapes) {
      const have = store.query('SELECT shape FROM card_shapes WHERE card_id = ?', [existing.id]).map((r) => r.shape);
      setShapes(existing.id, [...have, ...input.question_shapes]);
    }
    return { kind: 'merge', card: { ...existing, proof: nextProof, honesty_bound: nextBound } };
  }
  const cid = input.id || id('card', shape);
  store.exec(
    `INSERT INTO cards (id, employer_id, employer, claim, claim_shape, proof, honesty_bound, confidence, source, final_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cid,
      employerId,
      employer,
      claim,
      shape,
      input.proof || '',
      input.honesty_bound || '',
      input.confidence || 'corroborated',
      input.source || 'compile',
      input.final_id || null,
      now(),
    ]
  );
  if (input.tags) setTags(cid, input.tags);
  if (input.people) setPeople(cid, input.people);
  if (input.question_shapes) setShapes(cid, input.question_shapes);
  return { kind: 'create', card: { id: cid, employer, claim, claim_shape: shape } };
}

function replaceCard(input) {
  ensureOpen();
  const cid = String((input && input.id) || '').trim();
  const row = cid ? store.queryOne('SELECT * FROM cards WHERE id = ?', [cid]) : null;
  const claim = String((input && input.claim) || '').trim();
  if (!claim) return { ok: false, error: 'A card needs a claim.' };
  const employer = String(input && input.employer != null ? input.employer : (row && row.employer) || '').trim();
  const employerId = resolveEmployerId(employer, { create: Boolean(employer) }) || (row && row.employer_id) || '';
  const shape = claimShape(claim, employer);
  const clash = employerId
    ? findCard(employerId, shape)
    : store.queryOne('SELECT * FROM cards WHERE claim_shape = ?', [shape]);
  if (clash && clash.id !== cid) {
    return { ok: false, error: 'Another card already uses this claim for that employer.' };
  }
  const proof = String(input && input.proof != null ? input.proof : (row && row.proof) || '');
  const bound = String(input && input.honesty_bound != null ? input.honesty_bound : (row && row.honesty_bound) || '');
  const confidence = String((input && input.confidence) || (row && row.confidence) || 'corroborated').trim() || 'corroborated';
  const source = String((input && input.source) || (row && row.source) || 'library');
  if (!row) {
    const created = upsertCard({
      employer,
      claim,
      proof,
      honesty_bound: bound,
      confidence,
      source,
      tags: input.tags || [],
      people: input.people || [],
      question_shapes: input.shapes || [],
      createEmployer: Boolean(employer),
    });
    const id = created.card && created.card.id;
    if (!id) return { ok: false, error: 'Could not save that card.' };
    if (Array.isArray(input.tags)) setTags(id, input.tags);
    if (Array.isArray(input.people)) setPeople(id, input.people);
    if (Array.isArray(input.shapes)) setShapes(id, input.shapes);
    return { ok: true, id, card: { id, employer, claim } };
  }
  store.exec(
    `UPDATE cards SET employer_id = ?, employer = ?, claim = ?, claim_shape = ?, proof = ?, honesty_bound = ?, confidence = ?, source = ?
     WHERE id = ?`,
    [employerId, employer, claim, shape, proof, bound, confidence, source, cid]
  );
  if (Array.isArray(input.tags)) setTags(cid, input.tags);
  if (Array.isArray(input.people)) setPeople(cid, input.people);
  if (Array.isArray(input.shapes)) setShapes(cid, input.shapes);
  return { ok: true, id: cid, card: { id: cid, employer, claim } };
}

function setCardConfidence(id, confidence) {
  ensureOpen();
  const cid = String(id || '').trim();
  const next = String(confidence || '').trim();
  if (!cid || !next) return { kind: 'no-op' };
  const row = store.queryOne('SELECT * FROM cards WHERE id = ?', [cid]);
  if (!row) return { kind: 'no-op' };
  if (row.confidence === next) return { kind: 'no-op', card: row };
  store.exec('UPDATE cards SET confidence = ? WHERE id = ?', [next, cid]);
  return { kind: 'confirm', card: { ...row, confidence: next } };
}

function addBinding({ question_shape, card_id, tag, source }) {
  const shape = String(question_shape || '').trim().toLowerCase();
  if (!shape || (!card_id && !tag)) return { kind: 'no-op' };
  const dup = store
    .query('SELECT * FROM bindings WHERE question_shape = ?', [shape])
    .find((b) => (b.card_id || '') === (card_id || '') && (b.tag || '') === (tag || ''));
  if (dup) return { kind: 'no-op', binding: dup };
  const bid = id('bind', shape + (card_id || tag));
  store.exec(
    'INSERT INTO bindings (id, question_shape, card_id, tag, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [bid, shape, card_id || null, tag || null, source || 'assert', now()]
  );
  return { kind: 'bind', binding: { id: bid, question_shape: shape, card_id, tag } };
}

function addEvent(kind, payload, requestId) {
  store.exec('INSERT INTO events (ts, kind, payload, request_id) VALUES (?, ?, ?, ?)', [
    now(),
    kind,
    JSON.stringify(payload || {}),
    requestId || null,
  ]);
}

function cardIndex(opts = {}) {
  ensureOpen();
  const min = opts.minConfidence || 'corroborated';
  const rows = store.query(
    `SELECT c.id, c.employer, c.claim, c.honesty_bound, c.confidence,
            GROUP_CONCAT(t.tag, ',') AS tags
     FROM cards c LEFT JOIN card_tags t ON t.card_id = c.id
     WHERE c.confidence = ? OR ? = 'any'
     GROUP BY c.id
     ORDER BY c.employer, c.claim`,
    [min, min]
  );
  return rows.map((r) => ({
    id: r.id,
    employer: r.employer,
    claim: r.claim,
    honesty_bound: r.honesty_bound || '',
    tags: String(r.tags || '')
      .split(',')
      .filter(Boolean),
    confidence: r.confidence,
  }));
}

function cardBodies(ids) {
  ensureOpen();
  const want = (ids || []).map(String).filter(Boolean);
  if (!want.length) return [];
  const out = [];
  for (const cid of want) {
    const row = store.queryOne('SELECT * FROM cards WHERE id = ?', [cid]);
    if (!row) continue;
    const tags = store.query('SELECT tag FROM card_tags WHERE card_id = ?', [cid]).map((t) => t.tag);
    out.push({
      id: row.id,
      employer: row.employer,
      claim: row.claim,
      proof: row.proof || '',
      honesty_bound: row.honesty_bound || '',
      tags,
    });
  }
  return out;
}

function allCardBodies(opts = {}) {
  return cardBodies(cardIndex(opts).map((c) => c.id));
}

function bindingsFor(shape) {
  ensureOpen();
  const q = String(shape || '').toLowerCase();
  if (!q) return store.query('SELECT * FROM bindings');
  return store.query('SELECT * FROM bindings WHERE question_shape = ? OR question_shape = ?', [q, 'any']);
}

function filterIndex(index, bindings) {
  const mustIds = new Set((bindings || []).map((b) => b.card_id).filter(Boolean));
  const mustTags = new Set((bindings || []).map((b) => b.tag).filter(Boolean));
  if (!mustIds.size && !mustTags.size) return index;
  return index.filter((c) => {
    if (mustIds.has(c.id)) return true;
    if ((c.tags || []).some((t) => mustTags.has(t))) return true;
    return false;
  });
}

function currentVoice() {
  ensureOpen();
  const row = store.queryOne('SELECT * FROM voice_versions ORDER BY id DESC LIMIT 1');
  return row || null;
}

function seedVoiceFromFile(text) {
  ensureOpen();
  if (currentVoice()) return currentVoice();
  const body = String(text || '').trim();
  if (!body) return null;
  return addVoiceVersion({ kind: 'user', text: body });
}

function voiceHistory(limit = 40) {
  ensureOpen();
  return store.query('SELECT id, kind, parent_id, created_at, substr(text,1,160) AS preview FROM voice_versions ORDER BY id DESC LIMIT ?', [
    limit,
  ]);
}

function voiceById(vid) {
  return store.queryOne('SELECT * FROM voice_versions WHERE id = ?', [vid]);
}

function addVoiceVersion({ kind, text, parent_id, source_final_ids }) {
  ensureOpen();
  store.exec(
    'INSERT INTO voice_versions (kind, text, parent_id, created_at, source_final_ids) VALUES (?, ?, ?, ?, ?)',
    [kind, String(text ?? ''), parent_id || null, now(), source_final_ids ? JSON.stringify(source_final_ids) : null]
  );
  return store.queryOne('SELECT * FROM voice_versions ORDER BY id DESC LIMIT 1');
}

function pendingRules() {
  ensureOpen();
  return store.query('SELECT * FROM voice_pending_rules ORDER BY created_at');
}

function upsertPendingRule(ruleId, text) {
  ensureOpen();
  const have = store.queryOne('SELECT * FROM voice_pending_rules WHERE rule_id = ?', [ruleId]);
  if (have) {
    store.exec('UPDATE voice_pending_rules SET count = count + 1, text = ? WHERE rule_id = ?', [text, ruleId]);
    return { ...have, count: have.count + 1, text };
  }
  store.exec('INSERT INTO voice_pending_rules (id, rule_id, text, count, created_at) VALUES (?, ?, ?, 1, ?)', [
    id('pr', ruleId),
    ruleId,
    text,
    now(),
  ]);
  return { rule_id: ruleId, text, count: 1 };
}

function clearPending() {
  store.exec('DELETE FROM voice_pending_rules');
}

function pendingRuleText() {
  return pendingRules()
    .map((r) => `- ${r.text}`)
    .join('\n');
}

module.exports = {
  id,
  claimShape,
  now,
  ensureOpen,
  timelineId,
  upsertTimeline,
  addStub,
  upsertCard,
  replaceCard,
  setCardConfidence,
  setPeople,
  setShapes,
  addLink,
  listTags,
  indexForTags,
  addBinding,
  addEvent,
  cardIndex,
  cardBodies,
  allCardBodies,
  bindingsFor,
  filterIndex,
  currentVoice,
  seedVoiceFromFile,
  voiceHistory,
  voiceById,
  addVoiceVersion,
  pendingRules,
  upsertPendingRule,
  clearPending,
  pendingRuleText,
  listTimeline,
  findTimelineByEmployer,
  resolveEmployerId,
  deleteTimeline,
  deleteCard,
};
