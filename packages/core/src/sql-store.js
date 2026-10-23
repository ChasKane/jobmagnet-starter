const { shapeJob, filterBucket, urlKeys, jobHasUrl } = require('./jobs');
const { mergeBoards, upsertBoardList, boardFromUrl } = require('./boards');
const { emptyProcess, applyProcessEvent } = require('./memory-store');
const { applyConfirm, applyContradict, listAnswers } = require('../../../lib/confirmations');
const sidebarFilters = require('../../../lib/sidebar-filters');
const chatTabs = require('../../../lib/chat-tabs');

function now() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function asChatState(raw) {
  if (Array.isArray(raw)) {
    return {
      messages: raw.slice(),
      folded: [],
      agentId: '',
      snapshotKey: '',
      company: '',
      title: '',
      pageSubtab: 'chat',
    };
  }
  if (raw && typeof raw === 'object') {
    return {
      messages: Array.isArray(raw.messages) ? raw.messages.slice() : [],
      folded: Array.isArray(raw.folded) ? raw.folded.slice() : [],
      agentId: String(raw.agentId || ''),
      snapshotKey: String(raw.snapshotKey || ''),
      company: String(raw.company || ''),
      title: String(raw.title || ''),
      pageSubtab: chatTabs.asPageSubtab(raw.pageSubtab),
    };
  }
  return {
    messages: [],
    folded: [],
    agentId: '',
    snapshotKey: '',
    company: '',
    title: '',
    pageSubtab: 'chat',
  };
}

function foldConfirmations(profile, rows) {
  let next = profile && typeof profile === 'object' ? { ...profile } : {};
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!item || !item.class) continue;
    if (item.confidence === 'contradicted') next = applyContradict(next, item.class, item).doc;
    else if (item.value != null && String(item.value).trim()) next = applyConfirm(next, item.class, item.value, item).doc;
  }
  return next;
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    company: row.company || '',
    title: row.title || '',
    name: row.company || row.title || '',
    linkedin: row.linkedin || '',
    posting: row.posting || '',
    logo: row.logo || '',
    hostname: row.hostname || '',
    salary: row.salary || '',
    yoe: row.yoe || '',
    level: row.level || '',
    industries: parseJson(row.industries, []),
    skills: parseJson(row.skills, []),
    notes: row.notes || '',
    sortIndex: Number(row.sort_index) || 0,
    updatedAt: row.updated_at || '',
  };
}

function processFromRow(row) {
  if (!row) return emptyProcess();
  return {
    status: row.status || 'open',
    submitted_at: row.submitted_at,
    rejected_at: row.rejected_at,
    contacts: parseJson(row.contacts, []),
    events: parseJson(row.events, []),
    prep_notes: row.prep_notes || '',
    jd: parseJson(row.jd, null),
    posting: parseJson(row.posting, null),
    essays: parseJson(row.essays, []),
    updated_at: row.updated_at || null,
  };
}

function createSqlStore(driver) {
  if (!driver) throw new Error('createSqlStore requires a driver');

  function kvGet(key, fallback) {
    const row = driver.queryOne('SELECT value FROM kv WHERE key = ?', [key]);
    return row ? parseJson(row.value, fallback) : fallback;
  }

  function kvSet(key, value) {
    driver.exec('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      json(value),
    ]);
  }

  function kvDel(key) {
    driver.exec('DELETE FROM kv WHERE key = ?', [key]);
  }

  function listJobRows() {
    return driver.query('SELECT * FROM jobs ORDER BY sort_index, id').map(rowToJob);
  }

  function upsertJobRow(job, index) {
    const row = shapeJob(job, index);
    driver.exec(
      `INSERT INTO jobs(id, url, company, title, linkedin, posting, logo, hostname, salary, yoe, level, industries, skills, notes, sort_index, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         url=excluded.url, company=excluded.company, title=excluded.title, linkedin=excluded.linkedin,
         posting=excluded.posting, logo=excluded.logo, hostname=excluded.hostname, salary=excluded.salary,
         yoe=excluded.yoe, level=excluded.level, industries=excluded.industries, skills=excluded.skills,
         notes=excluded.notes, sort_index=excluded.sort_index, updated_at=excluded.updated_at`,
      [
        row.id,
        row.url,
        row.company,
        row.title,
        row.linkedin,
        row.posting,
        row.logo,
        row.hostname,
        row.salary,
        row.yoe,
        row.level,
        json(row.industries),
        json(row.skills),
        row.notes,
        row.sortIndex != null ? row.sortIndex : index || 0,
        now(),
      ]
    );
    return row;
  }

  function writeProcessRow(url, rec) {
    driver.exec(
      `INSERT INTO process_records(url, status, submitted_at, rejected_at, contacts, events, prep_notes, jd, posting, essays, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(url) DO UPDATE SET
         status=excluded.status, submitted_at=excluded.submitted_at, rejected_at=excluded.rejected_at,
         contacts=excluded.contacts, events=excluded.events, prep_notes=excluded.prep_notes,
         jd=excluded.jd, posting=excluded.posting, essays=excluded.essays, updated_at=excluded.updated_at`,
      [
        url,
        rec.status || 'open',
        rec.submitted_at || null,
        rec.rejected_at || null,
        json(rec.contacts || []),
        json(rec.events || []),
        rec.prep_notes || '',
        json(rec.jd || null),
        json(rec.posting || null),
        json(rec.essays || []),
        now(),
      ]
    );
    return rec;
  }

  function nextSortIndex() {
    const row = driver.queryOne('SELECT COALESCE(MAX(sort_index), -1) AS n FROM jobs');
    return Number(row && row.n) + 1;
  }

  function listResumeRows() {
    return driver.query('SELECT * FROM resumes ORDER BY is_default DESC, id').map((row) => ({
      id: row.id,
      label: row.label,
      filename: row.filename,
      mime: row.mime || 'application/pdf',
      match: parseJson(row.match_patterns, []),
      isDefault: Boolean(row.is_default),
      relPath: row.rel_path || '',
      abs: row.rel_path || '',
      bytes: row.bytes || kvGet(`resumeBytes:${row.id}`, null),
      importedAt: row.imported_at,
    }));
  }

  const api = {
    listJobs() {
      return listJobRows().map((job, i) => {
        const rec = processFromRow(driver.queryOne('SELECT * FROM process_records WHERE url = ?', [job.url]));
        return {
          ...job,
          status: rec.status || 'open',
          bucket: filterBucket(rec.status),
          sortIndex: job.sortIndex != null ? job.sortIndex : i,
          updatedAt: sidebarFilters.updatedAt(job, rec),
        };
      });
    },
    hasJobUrl(...vals) {
      const want = new Set(urlKeys(...vals));
      if (!want.size) return false;
      return listJobRows().some((job) => jobHasUrl(job, want));
    },
    upsertJob(job) {
      const row = upsertJobRow(job, nextSortIndex());
      const learned = boardFromUrl(row.url) || boardFromUrl(row.posting);
      if (learned) api.upsertBoard(learned, row.company);
      return row;
    },
    listBoards() {
      return mergeBoards(kvGet('boards', []));
    },
    upsertBoard(partial, company) {
      const next = upsertBoardList(api.listBoards(), partial, company);
      kvSet('boards', next);
      const ats = String((partial && partial.ats) || '').toLowerCase();
      const slug = String((partial && partial.slug) || '');
      return next.find((b) => b.ats === ats && b.slug === slug) || null;
    },
    removeJob(id) {
      driver.exec('DELETE FROM jobs WHERE id = ?', [String(id)]);
      return { ok: true };
    },
    getJob(id) {
      return rowToJob(driver.queryOne('SELECT * FROM jobs WHERE id = ?', [String(id)]));
    },
    getProcess(url) {
      const rec = processFromRow(driver.queryOne('SELECT * FROM process_records WHERE url = ?', [url]));
      const extra = kvGet(`processExtra:${url}`, {});
      return {
        ...rec,
        review: extra.review || rec.review || [],
        debrief: extra.debrief || rec.debrief || null,
      };
    },
    writeProcess(url, patch) {
      const prev = api.getProcess(url);
      const next = { ...prev, ...patch };
      writeProcessRow(url, next);
      kvSet(`processExtra:${url}`, { review: next.review || [], debrief: next.debrief || null });
      return next;
    },
    appendProcessEvent(url, event) {
      return api.writeProcess(url, applyProcessEvent(api.getProcess(url), event));
    },
    addProcessContact(url, contact) {
      const rec = api.getProcess(url);
      rec.contacts = [
        ...(rec.contacts || []),
        { id: contact.id || `c-${Date.now()}`, name: contact.name || '', role: contact.role || '', email: contact.email || '' },
      ];
      return api.writeProcess(url, rec);
    },
    getTotals() {
      return kvGet('totals', { submitted: 0, passed: 0, rejected: 0 });
    },
    bumpTotal(kind) {
      const totals = api.getTotals();
      const key = String(kind || '');
      if (!Object.prototype.hasOwnProperty.call(totals, key)) totals[key] = 0;
      totals[key] += 1;
      kvSet('totals', totals);
      return totals;
    },
    setTotals(next) {
      const totals = { submitted: 0, passed: 0, rejected: 0, ...(next || {}) };
      kvSet('totals', totals);
      return totals;
    },
    getSettings() {
      return kvGet('settings', {
        chatSound: true,
        contextCtrlTab: false,
        handedness: 'right',
        uiLanguage: 'en-US',
        modelId: 'grok-4.6',
        modelParams: { fast: 'true' },
        customModels: [],
      });
    },
    saveSettings(patch) {
      const next = { ...api.getSettings(), ...(patch || {}) };
      kvSet('settings', next);
      return next;
    },
    listResumes: listResumeRows,
    importResume(row) {
      const id = String(row.id || `resume-${Date.now()}`);
      const filename = String(row.filename || `${id}.pdf`);
      const bytes = typeof row.bytes === 'string' ? row.bytes : row.bytes || null;
      driver.exec(
        `INSERT INTO resumes(id, label, filename, mime, match_patterns, is_default, rel_path, imported_at, bytes)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           label=excluded.label, filename=excluded.filename, mime=excluded.mime,
           match_patterns=excluded.match_patterns, is_default=excluded.is_default,
           rel_path=excluded.rel_path, imported_at=excluded.imported_at, bytes=excluded.bytes`,
        [
          id,
          row.label || filename,
          filename,
          row.mime || 'application/pdf',
          json(Array.isArray(row.match) ? row.match : []),
          row.isDefault || id === 'default' ? 1 : 0,
          row.relPath || row.rel_path || row.abs || '',
          row.importedAt || now(),
          bytes,
        ]
      );
      if (bytes) kvSet(`resumeBytes:${id}`, bytes);
      return listResumeRows().find((r) => r.id === id);
    },
    getResume(id) {
      return listResumeRows().find((r) => r.id === String(id)) || null;
    },
    pickResume(job, overrideId) {
      const list = listResumeRows();
      if (overrideId) {
        const hit = list.find((r) => r.id === String(overrideId));
        if (hit) return hit;
      }
      const hay = [job && job.title, job && job.level, job && job.name, job && job.company].filter(Boolean).join(' ');
      for (const row of list) {
        if ((row.match || []).some((p) => new RegExp(p, 'i').test(hay))) return row;
      }
      return list.find((r) => r.isDefault || r.id === 'default') || list[0] || null;
    },
    getVoice() {
      return kvGet('voice', '');
    },
    setVoice(text) {
      const next = String(text ?? '');
      kvSet('voice', next);
      return next;
    },
    getSystemPrompt() {
      return kvGet('systemPrompt', '');
    },
    setSystemPrompt(text) {
      const next = String(text ?? '');
      kvSet('systemPrompt', next);
      return next;
    },
    getChat(key) {
      return api.getChatState(key).messages;
    },
    getChatState(key) {
      const row = driver.queryOne('SELECT messages FROM chats WHERE key = ?', [String(key)]);
      if (!row) {
        return { url: String(key), ...asChatState([]) };
      }
      return { url: String(key), ...asChatState(parseJson(row.messages, [])) };
    },
    listChats() {
      return driver.query('SELECT key, messages FROM chats').map((r) => {
        const payload = asChatState(parseJson(r.messages, []));
        return {
          key: r.key,
          url: r.key,
          company: payload.company,
          title: payload.title,
          messages: payload.messages,
          pageSubtab: payload.pageSubtab,
        };
      });
    },
    getChatUi() {
      return chatTabs.normalizeUi(kvGet('chatUi', chatTabs.emptyUi()));
    },
    saveChatUi(ui) {
      const next = chatTabs.normalizeUi(ui);
      kvSet('chatUi', next);
      return next;
    },
    saveChat(key, messages, meta = {}) {
      const prev = api.getChatState(key);
      const fromObject = messages && !Array.isArray(messages) && typeof messages === 'object';
      const payload = fromObject
        ? { ...prev, ...asChatState(messages), url: undefined }
        : {
            messages: Array.isArray(messages) ? messages.slice() : [],
            folded: meta.folded !== undefined ? meta.folded : prev.folded,
            agentId: meta.agentId !== undefined ? String(meta.agentId) : prev.agentId,
            snapshotKey: meta.snapshotKey !== undefined ? String(meta.snapshotKey) : prev.snapshotKey,
            company: meta.company !== undefined ? String(meta.company) : prev.company,
            title: meta.title !== undefined ? String(meta.title) : prev.title,
            pageSubtab: meta.pageSubtab !== undefined ? chatTabs.asPageSubtab(meta.pageSubtab) : prev.pageSubtab,
          };
      driver.exec(
        'INSERT INTO chats(key, messages, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET messages=excluded.messages, updated_at=excluded.updated_at',
        [String(key), json(payload), now()]
      );
      return payload.messages;
    },
    getConfirmations() {
      return listAnswers(api.getProfile());
    },
    confirmClass(classId, value, extra = {}) {
      const { doc, row } = applyConfirm(api.getProfile(), classId, value, extra);
      api.setProfile(doc);
      return row;
    },
    listRecipes() {
      return driver.query('SELECT * FROM recipe_items').map((r) => parseJson(r.payload, {}));
    },
    saveRecipe(recipe) {
      const id = String((recipe && recipe.id) || `recipe-${Date.now()}`);
      const row = { ...recipe, id };
      driver.exec(
        'INSERT INTO recipe_items(id, payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [id, json(row)]
      );
      return row;
    },
    getProfile() {
      return kvGet('profile', {});
    },
    setProfile(profile) {
      const next = profile && typeof profile === 'object' ? profile : {};
      kvSet('profile', next);
      return next;
    },
    getMailQueue() {
      return driver.query('SELECT * FROM mail_items ORDER BY created_at').map((r) => parseJson(r.payload, {}));
    },
    addMailItem(item) {
      const row = { id: item.id || `mail-${Date.now()}`, ...item };
      driver.exec(
        'INSERT INTO mail_items(id, payload, created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [row.id, json(row), now()]
      );
      return row;
    },
    removeMailItem(id) {
      driver.exec('DELETE FROM mail_items WHERE id = ?', [String(id)]);
      return api.getMailQueue();
    },
    getHuntSession() {
      return kvGet('huntSession', null);
    },
    saveHuntSession(row) {
      if (row == null) {
        kvDel('huntSession');
        return null;
      }
      kvSet('huntSession', row);
      return row;
    },
    getMailStatus() {
      return { ...kvGet('mailStatus', { connected: false, email: '', scanned_at: null, indexed: 0, pending: 0 }), pending: api.getMailQueue().length };
    },
    setMailStatus(patch) {
      const next = { ...api.getMailStatus(), ...(patch || {}) };
      kvSet('mailStatus', next);
      return next;
    },
    lastOutcome() {
      return kvGet('lastOutcome', null);
    },
    saveLastOutcome(row) {
      if (!row) {
        kvDel('lastOutcome');
        return null;
      }
      kvSet('lastOutcome', row);
      return row;
    },
    cardIndex() {
      return driver.query(
        `SELECT c.id, c.employer, c.claim, c.honesty_bound, c.confidence, GROUP_CONCAT(t.tag, ',') AS tags
         FROM cards c LEFT JOIN card_tags t ON t.card_id = c.id
         WHERE c.confidence = 'corroborated'
         GROUP BY c.id
         ORDER BY c.employer, c.claim`
      ).map((r) => ({
        id: r.id,
        employer: r.employer,
        claim: r.claim,
        honesty_bound: r.honesty_bound || '',
        tags: String(r.tags || '')
          .split(',')
          .filter(Boolean),
        confidence: r.confidence,
      }));
    },
    cardBodies(ids) {
      const want = (ids || []).map(String).filter(Boolean);
      return want
        .map((cid) => {
          const row = driver.queryOne('SELECT * FROM cards WHERE id = ?', [cid]);
          if (!row) return null;
          const tags = driver.query('SELECT tag FROM card_tags WHERE card_id = ?', [cid]).map((t) => t.tag);
          return {
            id: row.id,
            employer: row.employer,
            claim: row.claim,
            proof: row.proof || '',
            honesty_bound: row.honesty_bound || '',
            tags,
          };
        })
        .filter(Boolean);
    },
    bindingsFor(shape) {
      const q = String(shape || '').toLowerCase();
      if (!q) return driver.query('SELECT * FROM bindings');
      return driver.query('SELECT * FROM bindings WHERE question_shape = ? OR question_shape = ?', [q, 'any']);
    },
    pickTurnBodies(payload = {}) {
      const inferShape = payload.inferShape;
      const shape = typeof inferShape === 'function' ? inferShape(payload.fields, payload.instruction) : payload.shape || '';
      const bindings = api.bindingsFor(shape);
      const boundIds = bindings.map((b) => b.card_id).filter(Boolean);
      const boundTags = bindings.map((b) => b.tag).filter(Boolean);
      const index = api.cardIndex();
      let ids = index
        .filter((c) => boundIds.includes(c.id) || (c.tags || []).some((t) => boundTags.includes(t)))
        .map((c) => c.id);
      const extra = Array.isArray(payload.retrieveCardIds) ? payload.retrieveCardIds : [];
      if (!ids.length && !extra.length) {
        const words = `${payload.instruction || ''} ${payload.company || ''} ${payload.title || ''} ${((payload.fields || []).map((f) => f.label || '').join(' '))}`
          .toLowerCase()
          .split(/[^a-z0-9+#]+/i)
          .filter((w) => w.length > 3);
        ids = index
          .filter((c) => {
            const blob = `${c.employer || ''} ${c.claim || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
            return !words.length || words.some((w) => blob.includes(w));
          })
          .slice(0, 6)
          .map((c) => c.id);
      }
      return api.cardBodies([...new Set(ids.concat(extra))]);
    },
    searchAnswers(args = {}) {
      const limit = Math.max(1, Math.min(8, Number(args.limit) || 3));
      const q = String(args.query || args.similar_to || args.company || '').toLowerCase();
      const hits = [];
      for (const row of driver.query('SELECT * FROM process_records')) {
        const rec = processFromRow(row);
        for (const essay of rec.essays || []) {
          const blob = `${essay.company || ''} ${essay.label || ''} ${essay.text || ''}`.toLowerCase();
          if (q && !blob.includes(q)) continue;
          hits.push({
            company: essay.company || '',
            label: essay.label || '',
            text: String(essay.text || ''),
            origin: essay.origin || 'applicant',
            ts: essay.ts || rec.submitted_at || '',
          });
        }
      }
      return hits.slice(0, limit);
    },
    exportGraph() {
      return {
        cards: driver.query('SELECT * FROM cards'),
        card_tags: driver.query('SELECT * FROM card_tags'),
        bindings: driver.query('SELECT * FROM bindings'),
        timeline: driver.query('SELECT * FROM timeline'),
        voice_versions: driver.query('SELECT * FROM voice_versions'),
      };
    },
    importGraph(dump) {
      if (!dump || typeof dump !== 'object') return { ok: false };
      for (const row of dump.timeline || []) {
        driver.exec(
          'INSERT OR REPLACE INTO timeline(id, employer, title, start, end, location, current) VALUES(?,?,?,?,?,?,?)',
          [row.id, row.employer, row.title || '', row.start || '', row.end || '', row.location || '', row.current || 0]
        );
      }
      for (const row of dump.cards || []) {
        driver.exec(
          `INSERT OR REPLACE INTO cards(id, employer_id, employer, claim, claim_shape, proof, honesty_bound, confidence, source, final_id, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [
            row.id,
            row.employer_id || '',
            row.employer || '',
            row.claim || '',
            row.claim_shape || row.id,
            row.proof || '',
            row.honesty_bound || '',
            row.confidence || 'corroborated',
            row.source || 'bundle',
            row.final_id || '',
            row.created_at || now(),
          ]
        );
      }
      for (const row of dump.card_tags || []) {
        driver.exec('INSERT OR IGNORE INTO card_tags(card_id, tag) VALUES(?,?)', [row.card_id, row.tag]);
      }
      for (const row of dump.bindings || []) {
        driver.exec(
          'INSERT OR REPLACE INTO bindings(id, question_shape, card_id, tag, source, created_at) VALUES(?,?,?,?,?,?)',
          [row.id, row.question_shape, row.card_id || '', row.tag || '', row.source || 'bundle', row.created_at || now()]
        );
      }
      return { ok: true };
    },
    exportBundle() {
      return {
        version: 1,
        exportedAt: now(),
        jobs: listJobRows(),
        process: { by_url: Object.fromEntries(driver.query('SELECT * FROM process_records').map((r) => [r.url, api.getProcess(r.url)])) },
        totals: api.getTotals(),
        settings: api.getSettings(),
        resumes: listResumeRows().map((r) => ({ ...r, abs: undefined })),
        chats: {
          by_url: Object.fromEntries(
            driver.query('SELECT * FROM chats').map((r) => [r.key, asChatState(parseJson(r.messages, []))])
          ),
          ui: api.getChatUi(),
        },
        voice: api.getVoice(),
        systemPrompt: api.getSystemPrompt(),
        confirmations: api.getConfirmations(),
        recipes: api.listRecipes(),
        profile: api.getProfile(),
        mail: { queue: api.getMailQueue(), status: api.getMailStatus() },
        boards: api.listBoards(),
        huntSession: api.getHuntSession(),
        graph: api.exportGraph(),
      };
    },
    importBundle(bundle) {
      if (!bundle || typeof bundle !== 'object') throw new Error('Invalid bundle');
      if (Array.isArray(bundle.jobs)) {
        driver.exec('DELETE FROM jobs');
        bundle.jobs.forEach((job, i) => upsertJobRow(job, i));
      }
      if (bundle.process && bundle.process.by_url) {
        for (const [url, rec] of Object.entries(bundle.process.by_url)) {
          writeProcessRow(url, { ...emptyProcess(), ...rec });
        }
      }
      if (bundle.totals) kvSet('totals', bundle.totals);
      if (bundle.settings) api.saveSettings(bundle.settings);
      if (Array.isArray(bundle.resumes)) bundle.resumes.forEach((r) => api.importResume(r));
      if (bundle.chats && bundle.chats.by_url) {
        for (const [key, messages] of Object.entries(bundle.chats.by_url)) api.saveChat(key, messages);
      }
      if (bundle.chats && bundle.chats.ui) api.saveChatUi(bundle.chats.ui);
      if (bundle.voice != null) api.setVoice(bundle.voice);
      if (bundle.systemPrompt != null) api.setSystemPrompt(bundle.systemPrompt);
      if (Array.isArray(bundle.recipes)) bundle.recipes.forEach((r) => api.saveRecipe(r));
      if (bundle.profile) api.setProfile(bundle.profile);
      if (Array.isArray(bundle.confirmations)) {
        api.setProfile(foldConfirmations(api.getProfile(), bundle.confirmations));
      }
      if (bundle.mail) {
        if (Array.isArray(bundle.mail.queue)) bundle.mail.queue.forEach((item) => api.addMailItem(item));
        if (bundle.mail.status) api.setMailStatus(bundle.mail.status);
      }
      if (Array.isArray(bundle.boards) && bundle.boards.length) kvSet('boards', mergeBoards(bundle.boards));
      if (bundle.huntSession !== undefined) api.saveHuntSession(bundle.huntSession);
      if (bundle.graph) api.importGraph(bundle.graph);
      return { ok: true, jobs: listJobRows().length };
    },
  };

  return api;
}

module.exports = { createSqlStore };
