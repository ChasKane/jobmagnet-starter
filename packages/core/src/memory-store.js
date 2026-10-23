const { shapeJob, filterBucket, urlKeys, jobHasUrl } = require('./jobs');
const sidebarFilters = require('../../../lib/sidebar-filters');
const { mergeBoards, upsertBoardList, boardFromUrl } = require('./boards');
const { applyConfirm, applyContradict, listAnswers } = require('../../../lib/confirmations');
const chatTabs = require('../../../lib/chat-tabs');

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

function emptyProcess() {
  return {
    status: 'open',
    submitted_at: null,
    rejected_at: null,
    contacts: [],
    events: [],
    prep_notes: '',
    jd: null,
    posting: null,
    essays: [],
  };
}

function now() {
  return new Date().toISOString();
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

function applyProcessEvent(rec, event) {
  const current = { ...emptyProcess(), ...(rec || {}) };
  const row = {
    at: (event && event.at) || now(),
    type: (event && event.type) || 'note',
    title: (event && (event.title || event.type)) || '',
    body: (event && event.body) || '',
    contact_id: (event && event.contact_id) || null,
    deleted: false,
  };
  current.events = [...(current.events || []), row];
  if (row.type === 'submitted') {
    current.status = 'submitted';
    current.submitted_at = current.submitted_at || row.at;
  } else if (row.type === 'passed') current.status = 'passed';
  else if (row.type === 'rejected') {
    current.status = 'rejected';
    current.rejected_at = row.at;
  } else if (row.type === 'offer') current.status = 'offer';
  else if (row.type === 'withdrawn') current.status = 'withdrawn';
  else if (
    ['recruiter_screen', 'hiring_manager', 'panel', 'onsite'].includes(row.type) &&
    current.status !== 'offer' &&
    current.status !== 'rejected'
  ) {
    current.status = 'interviewing';
  }
  return current;
}

function createMemoryStore(seed = {}) {
  const state = {
    jobs: Array.isArray(seed.jobs) ? seed.jobs.map((j, i) => shapeJob(j, i)) : [],
    process: seed.process && seed.process.by_url ? { ...seed.process.by_url } : {},
    totals: {
      submitted: 0,
      passed: 0,
      rejected: 0,
      ...(seed.totals || {}),
    },
    settings: {
      chatSound: true,
      contextCtrlTab: false,
      handedness: 'right',
      uiLanguage: 'en-US',
      modelId: 'grok-4.6',
      modelParams: { fast: 'true' },
      customModels: [],
      ...(seed.settings || {}),
    },
    resumes: Array.isArray(seed.resumes) ? seed.resumes.slice() : [],
    chats: seed.chats && seed.chats.by_url ? { ...seed.chats.by_url } : {},
    chatUi: chatTabs.normalizeUi(seed.chats && seed.chats.ui),
    voice: seed.voice || '',
    systemPrompt: seed.systemPrompt || '',
    recipes: Array.isArray(seed.recipes) ? seed.recipes.slice() : [],
    profile: foldConfirmations(
      seed.profile && typeof seed.profile === 'object' ? seed.profile : {},
      seed.confirmations
    ),
    mailQueue: Array.isArray(seed.mailQueue) ? seed.mailQueue.slice() : [],
    mailStatus: {
      connected: false,
      email: '',
      scanned_at: null,
      indexed: 0,
      pending: 0,
      ...(seed.mailStatus || {}),
    },
    huntSession: seed.huntSession || null,
    lastOutcome: seed.lastOutcome || null,
    boards: mergeBoards(seed.boards || []),
    graph: seed.graph || { cards: [], card_tags: [], bindings: [] },
  };

  function jobById(id) {
    return state.jobs.find((j) => j.id === String(id)) || null;
  }

  return {
    listJobs() {
      return state.jobs.map((job, i) => {
        const rec = state.process[job.url] || emptyProcess();
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
      return state.jobs.some((job) => jobHasUrl(job, want));
    },
    upsertJob(job) {
      const row = shapeJob(job, state.jobs.length);
      const idx = state.jobs.findIndex((j) => j.id === row.id || j.url === row.url);
      if (idx >= 0) state.jobs[idx] = { ...state.jobs[idx], ...row };
      else state.jobs.push(row);
      const learned = boardFromUrl(row.url) || boardFromUrl(row.posting);
      if (learned) state.boards = upsertBoardList(state.boards, learned, row.company);
      return row;
    },
    listBoards() {
      return state.boards.slice();
    },
    upsertBoard(partial, company) {
      state.boards = upsertBoardList(state.boards, partial, company);
      const ats = String((partial && partial.ats) || '').toLowerCase();
      const slug = String((partial && partial.slug) || '');
      return state.boards.find((b) => b.ats === ats && b.slug === slug) || null;
    },
    removeJob(id) {
      const before = state.jobs.length;
      state.jobs = state.jobs.filter((j) => j.id !== String(id));
      return { ok: before !== state.jobs.length };
    },
    getJob(id) {
      return jobById(id);
    },
    getProcess(url) {
      return { ...emptyProcess(), ...(state.process[url] || {}) };
    },
    writeProcess(url, patch) {
      const prev = { ...emptyProcess(), ...(state.process[url] || {}) };
      state.process[url] = { ...prev, ...patch, updated_at: now() };
      return state.process[url];
    },
    appendProcessEvent(url, event) {
      return this.writeProcess(url, applyProcessEvent(this.getProcess(url), event));
    },
    addProcessContact(url, contact) {
      const rec = this.getProcess(url);
      const row = {
        id: contact.id || `c-${Date.now()}`,
        name: contact.name || '',
        role: contact.role || '',
        email: contact.email || '',
      };
      rec.contacts = [...(rec.contacts || []), row];
      return this.writeProcess(url, rec);
    },
    getTotals() {
      return { ...state.totals };
    },
    bumpTotal(kind) {
      const key = String(kind || '');
      if (!Object.prototype.hasOwnProperty.call(state.totals, key)) state.totals[key] = 0;
      state.totals[key] += 1;
      return this.getTotals();
    },
    setTotals(next) {
      state.totals = { submitted: 0, passed: 0, rejected: 0, ...(next || {}) };
      return this.getTotals();
    },
    getSettings() {
      return { ...state.settings };
    },
    saveSettings(patch) {
      state.settings = { ...state.settings, ...(patch || {}) };
      return this.getSettings();
    },
    listResumes() {
      return state.resumes.map((r) => ({ ...r }));
    },
    importResume(row) {
      const item = {
        id: String(row.id || `resume-${Date.now()}`),
        label: String(row.label || row.filename || 'Resume'),
        filename: String(row.filename || `${row.id || 'resume'}.pdf`),
        mime: row.mime || 'application/pdf',
        match: Array.isArray(row.match) ? row.match : [],
        isDefault: Boolean(row.isDefault || row.id === 'default'),
        relPath: row.relPath || row.rel_path || '',
        abs: row.abs || '',
        bytes: row.bytes || null,
        importedAt: row.importedAt || now(),
      };
      const idx = state.resumes.findIndex((r) => r.id === item.id);
      if (idx >= 0) state.resumes[idx] = { ...state.resumes[idx], ...item };
      else state.resumes.push(item);
      return item;
    },
    getResume(id) {
      return state.resumes.find((r) => r.id === String(id)) || null;
    },
    pickResume(job, overrideId) {
      if (overrideId) {
        const hit = this.getResume(overrideId);
        if (hit) return hit;
      }
      const hay = [job && job.title, job && job.level, job && job.name, job && job.company]
        .filter(Boolean)
        .join(' ');
      for (const row of state.resumes) {
        const pats = Array.isArray(row.match) ? row.match : [];
        if (pats.some((p) => new RegExp(p, 'i').test(hay))) return row;
      }
      return state.resumes.find((r) => r.isDefault || r.id === 'default') || state.resumes[0] || null;
    },
    getVoice() {
      return state.voice;
    },
    setVoice(text) {
      state.voice = String(text ?? '');
      return state.voice;
    },
    getSystemPrompt() {
      return state.systemPrompt;
    },
    setSystemPrompt(text) {
      state.systemPrompt = String(text ?? '');
      return state.systemPrompt;
    },
    getChat(key) {
      return this.getChatState(key).messages;
    },
    getChatState(key) {
      return { url: String(key), ...asChatState(state.chats[key]) };
    },
    listChats() {
      return Object.entries(state.chats).map(([key, raw]) => {
        const row = asChatState(raw);
        return {
          key,
          url: key,
          company: row.company,
          title: row.title,
          messages: row.messages.slice(),
          pageSubtab: row.pageSubtab,
        };
      });
    },
    getChatUi() {
      return chatTabs.normalizeUi(state.chatUi);
    },
    saveChatUi(ui) {
      state.chatUi = chatTabs.normalizeUi(ui);
      return this.getChatUi();
    },
    saveChat(key, messages, meta = {}) {
      const prev = this.getChatState(key);
      const fromObject = messages && !Array.isArray(messages) && typeof messages === 'object';
      const next = fromObject
        ? { ...prev, ...asChatState(messages), url: undefined }
        : {
            ...prev,
            messages: Array.isArray(messages) ? messages.slice() : [],
            folded: meta.folded !== undefined ? meta.folded : prev.folded,
            agentId: meta.agentId !== undefined ? String(meta.agentId) : prev.agentId,
            snapshotKey: meta.snapshotKey !== undefined ? String(meta.snapshotKey) : prev.snapshotKey,
            company: meta.company !== undefined ? String(meta.company) : prev.company,
            title: meta.title !== undefined ? String(meta.title) : prev.title,
            pageSubtab: meta.pageSubtab !== undefined ? chatTabs.asPageSubtab(meta.pageSubtab) : prev.pageSubtab,
          };
      state.chats[key] = next;
      return this.getChat(key);
    },
    getConfirmations() {
      return listAnswers(state.profile);
    },
    confirmClass(classId, value, extra = {}) {
      const { doc, row } = applyConfirm(state.profile, classId, value, extra);
      state.profile = doc;
      return row;
    },
    listRecipes() {
      return state.recipes.slice();
    },
    saveRecipe(recipe) {
      const id = String((recipe && recipe.id) || `recipe-${Date.now()}`);
      const row = { ...recipe, id };
      const idx = state.recipes.findIndex((r) => r.id === id);
      if (idx >= 0) state.recipes[idx] = row;
      else state.recipes.push(row);
      return row;
    },
    getProfile() {
      return state.profile;
    },
    setProfile(profile) {
      state.profile = profile && typeof profile === 'object' ? profile : {};
      return state.profile;
    },
    getMailQueue() {
      return state.mailQueue.slice();
    },
    addMailItem(item) {
      const row = { id: item.id || `mail-${Date.now()}`, ...item };
      state.mailQueue = state.mailQueue.filter((m) => m.id !== row.id).concat(row);
      state.mailStatus.pending = state.mailQueue.length;
      return row;
    },
    removeMailItem(id) {
      state.mailQueue = state.mailQueue.filter((m) => m.id !== String(id));
      state.mailStatus.pending = state.mailQueue.length;
      return this.getMailQueue();
    },
    getHuntSession() {
      return state.huntSession;
    },
    saveHuntSession(row) {
      state.huntSession = row || null;
      return state.huntSession;
    },
    lastOutcome() {
      return state.lastOutcome;
    },
    saveLastOutcome(row) {
      state.lastOutcome = row || null;
      return state.lastOutcome;
    },
    cardIndex() {
      return Array.isArray(state.graph && state.graph.cards)
        ? state.graph.cards.map((c) => ({
            ...c,
            tags: (state.graph.card_tags || []).filter((t) => t.card_id === c.id).map((t) => t.tag),
          }))
        : [];
    },
    cardBodies(ids) {
      const want = new Set((ids || []).map(String));
      return this.cardIndex().filter((c) => want.has(String(c.id)));
    },
    bindingsFor(shape) {
      const rows = (state.graph && state.graph.bindings) || [];
      const q = String(shape || '').toLowerCase();
      if (!q) return rows.slice();
      return rows.filter((b) => b.question_shape === q || b.question_shape === 'any');
    },
    pickTurnBodies(payload = {}) {
      const inferShape = payload.inferShape;
      const shape =
        typeof inferShape === 'function' ? inferShape(payload.fields, payload.instruction) : payload.shape || '';
      const bindings = this.bindingsFor(shape);
      const boundIds = bindings.map((b) => b.card_id).filter(Boolean);
      const boundTags = bindings.map((b) => b.tag).filter(Boolean);
      const index = this.cardIndex();
      let ids = index
        .filter((c) => boundIds.includes(c.id) || (c.tags || []).some((t) => boundTags.includes(t)))
        .map((c) => c.id);
      const extra = Array.isArray(payload.retrieveCardIds) ? payload.retrieveCardIds : [];
      if (!ids.length && !extra.length) {
        const words = `${payload.instruction || ''} ${payload.company || ''} ${payload.title || ''} ${(
          payload.fields || []
        )
          .map((f) => f.label || '')
          .join(' ')}`
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
      return this.cardBodies([...new Set(ids.concat(extra))]);
    },
    searchAnswers(args = {}) {
      const limit = Math.max(1, Math.min(8, Number(args.limit) || 3));
      const q = String(args.query || args.similar_to || args.company || '').toLowerCase();
      const hits = [];
      for (const rec of Object.values(state.process)) {
        for (const essay of rec.essays || []) {
          const blob = `${essay.company || ''} ${essay.label || ''} ${essay.text || essay.final || ''}`.toLowerCase();
          if (q && !blob.includes(q)) continue;
          hits.push({
            company: essay.company || '',
            label: essay.label || '',
            text: String(essay.text || essay.final || ''),
            origin: essay.origin || 'applicant',
            ts: essay.ts || rec.submitted_at || '',
          });
        }
      }
      return hits.slice(0, limit);
    },
    getMailStatus() {
      return { ...state.mailStatus, pending: state.mailQueue.length };
    },
    setMailStatus(patch) {
      state.mailStatus = { ...state.mailStatus, ...(patch || {}) };
      return this.getMailStatus();
    },
    exportBundle() {
      return {
        version: 1,
        exportedAt: now(),
        jobs: state.jobs,
        process: { by_url: state.process },
        totals: state.totals,
        settings: state.settings,
        resumes: state.resumes.map((r) => ({
          ...r,
          bytes: typeof r.bytes === 'string' ? r.bytes : null,
          abs: undefined,
        })),
        chats: {
          by_url: Object.fromEntries(Object.entries(state.chats).map(([key, raw]) => [key, asChatState(raw)])),
          ui: this.getChatUi(),
        },
        voice: state.voice,
        systemPrompt: state.systemPrompt,
        confirmations: listAnswers(state.profile),
        recipes: state.recipes,
        profile: state.profile,
        mail: { queue: state.mailQueue, status: state.mailStatus },
        boards: state.boards,
        huntSession: state.huntSession,
        graph: state.graph,
      };
    },
    importBundle(bundle) {
      if (!bundle || typeof bundle !== 'object') throw new Error('Invalid bundle');
      if (Array.isArray(bundle.jobs)) state.jobs = bundle.jobs.map((j, i) => shapeJob(j, i));
      if (bundle.process && bundle.process.by_url) state.process = { ...bundle.process.by_url };
      if (bundle.totals) state.totals = { ...state.totals, ...bundle.totals };
      if (bundle.settings) state.settings = { ...state.settings, ...bundle.settings };
      if (Array.isArray(bundle.resumes)) {
        state.resumes = bundle.resumes.map((r) => ({
          ...r,
          bytes: typeof r.bytes === 'string' ? r.bytes : r.bytes || null,
        }));
      }
      if (bundle.chats && bundle.chats.by_url) state.chats = { ...bundle.chats.by_url };
      if (bundle.chats && bundle.chats.ui) state.chatUi = chatTabs.normalizeUi(bundle.chats.ui);
      if (bundle.voice != null) state.voice = String(bundle.voice);
      if (bundle.systemPrompt != null) state.systemPrompt = String(bundle.systemPrompt);
      if (Array.isArray(bundle.recipes)) state.recipes = bundle.recipes.slice();
      if (bundle.profile) state.profile = bundle.profile;
      if (Array.isArray(bundle.confirmations)) {
        state.profile = foldConfirmations(state.profile, bundle.confirmations);
      }
      if (bundle.mail) {
        state.mailQueue = Array.isArray(bundle.mail.queue) ? bundle.mail.queue.slice() : [];
        state.mailStatus = { ...state.mailStatus, ...(bundle.mail.status || {}) };
      }
      if (Array.isArray(bundle.boards) && bundle.boards.length) {
        state.boards = mergeBoards(state.boards.concat(bundle.boards));
      }
      if (bundle.huntSession !== undefined) state.huntSession = bundle.huntSession || null;
      if (bundle.graph) state.graph = bundle.graph;
      return { ok: true, jobs: state.jobs.length };
    },
    _state: state,
  };
}

module.exports = { createMemoryStore, emptyProcess, applyProcessEvent };
