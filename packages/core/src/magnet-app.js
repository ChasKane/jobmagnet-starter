const { COMMANDS, isCommand } = require('./commands');
const { filterBucket, shapeJob, urlsFromText } = require('./jobs');
const { valueFromProfile } = require('./static-values');
const { reviewMessage } = require('./mail-decide');
const {
  compileSearchSchema,
  looksLikeSearch,
  looksLikeApprove,
  normalizeSchema,
  schemaReady,
  formatPlanReply,
} = require('./search-schema');
const { heldSet, isHeld, holdKeys } = require('./company-hold');
const { hasAutofillRun, jobLooksFilled } = require('./autofill-queue');
const { notifyQueuedMail, unreadMailNotices, markMailRead } = require('./mail-notify');
const { boardFromUrl, huntJobs } = require('./boards');
const { runJsonHunt } = require('./llm-hunt');
const { huntStartUrls } = require('./hunt-start');
const { pageJdReady } = require('./hunt-page');
const { runPortableAutofill, harvestPortable, retrievePack } = require('./apply-run');
const { snapshotRecord, revertRecord, countKind, eventTypeOf } = require('../../../lib/outcome-undo');
const chatTabs = require('../../../lib/chat-tabs');
const sidebarFilters = require('../../../lib/sidebar-filters');

function chatKeyOf(id) {
  return id || chatTabs.INGEST_KEY;
}

function touchChat(store, key) {
  if (!store || typeof store.saveChatUi !== 'function') return;
  const prev = typeof store.getChatUi === 'function' ? store.getChatUi() : chatTabs.emptyUi();
  store.saveChatUi(chatTabs.bumpTab(prev, key));
}

function classifyField(field) {
  const label = String((field && field.label) || '');
  if (/\b(why|tell us|describe|cover letter|in your own words)\b/i.test(label)) {
    return { route: 'needs_llm', reason: 'heuristic-llm' };
  }
  return { route: 'static', reason: 'heuristic-static' };
}

function reviewGate() {
  return { ask: false, reason: 'portable' };
}

function filterAskable(fields) {
  return fields || [];
}

function chatRows(store) {
  if (store && typeof store.listChats === 'function') return store.listChats();
  return [];
}

function lastPlan(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].plan) return list[i].plan;
  }
  return null;
}

function emitStep(onStep, id, extra) {
  if (typeof onStep !== 'function') return;
  try {
    onStep(id, extra || {});
  } catch (_) {}
}

function mailShortcut(text) {
  const s = String(text || '').trim();
  if (/connect (?:my )?gmail|sign in to gmail|gmail sign[- ]?in/i.test(s)) {
    return { action: 'connect_mail', needMailConnect: true };
  }
  if (/scan (?:my )?(?:mail|inbox|gmail)|check (?:my )?gmail/i.test(s)) {
    return { action: 'scan_mail', needMailScan: true };
  }
  return null;
}

function FIND_FILE_SCRIPT() {
  return `(() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  const visible = inputs.filter((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (el.disabled) return false;
    if (st.display === 'none') return false;
    return true;
  });
  const named = (el) => /resume|cv|upload/i.test(el.name + el.id + (el.getAttribute('aria-label') || ''));
  const el = visible.find(named) || inputs.find(named) || visible[0] || inputs[0];
  if (!el) return { ok: false };
  const label = (el.closest('label') && el.closest('label').innerText) || '';
  if (/[.](pdf|docx?)/i.test(label) || (el.files && el.files.length)) {
    return { ok: true, already: true, selector: el.id ? ('#' + CSS.escape(el.id)) : 'input[type="file"]' };
  }
  if (!el.id) el.setAttribute('data-magnet-file', '1');
  return {
    ok: true,
    already: false,
    selector: el.id ? ('#' + CSS.escape(el.id)) : '[data-magnet-file="1"]',
  };
})()`;
}

function simpleFillScript(fieldId, value) {
  const id = JSON.stringify(String(fieldId || ''));
  const val = JSON.stringify(String(value ?? ''));
  return `(() => {
    const id = ${id};
    const value = ${val};
    const el = document.querySelector('[data-magnet-field="'+id+'"]')
      || document.getElementById(id)
      || document.querySelector('[name="'+id+'"]');
    if (!el) return { ok: false, error: 'missing' };
    el.focus();
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find((o) => o.value === value || o.text === value);
      if (opt) el.value = opt.value;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = /^(yes|true|on|1)$/i.test(value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: el.value };
  })()`;
}

function createMagnetApp(ports = {}) {
  const store = ports.store;
  if (!store) throw new Error('MagnetApp requires a store port');
  const files = ports.files || {};
  const llm = ports.llm || {};
  const mail = ports.mail || {};
  const clock = ports.clock || { now: () => Date.now() };
  let fillCancelled = false;

  function jobOrThrow(id) {
    const job = store.getJob(id);
    if (!job) {
      const listed = store.listJobs().find((j) => j.id === String(id) || j.url === String(id));
      if (listed) return listed;
      throw new Error('Unknown job');
    }
    return job;
  }

  function browserFor(jobId) {
    if (typeof ports.browserFor === 'function') return ports.browserFor(jobId);
    return ports.browser || null;
  }

  const app = {
    commands: COMMANDS,

    async dispatch(name, payload) {
      if (!isCommand(name)) return { ok: false, error: `unknown command: ${name}` };
      try {
        const result = await app[name](payload || {});
        return result && typeof result === 'object' ? result : { ok: true, result };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    },

    listJobs(filter = {}) {
      const jobs = sidebarFilters.apply(store.listJobs(), {
        status: 'all',
        yoe: 'all',
        level: 'all',
        q: '',
        sort: 'added',
        ...filter,
      });
      return {
        ok: true,
        jobs,
        totals: store.getTotals(),
        activeId: filter.activeId || null,
      };
    },

    upsertJob(job) {
      const row = store.upsertJob(shapeJob(job));
      return { ok: true, job: row };
    },

    removeJob({ id }) {
      return { ok: true, ...(store.removeJob(id) || {}) };
    },

    async completeJob({ id, url, jd, essays }) {
      const job = id ? jobOrThrow(id) : { url };
      const processUrl = job.url || url;
      const before = store.getProcess(processUrl);
      const browser = job.id ? browserFor(job.id) : null;
      let harvested = Array.isArray(essays) ? essays : [];
      if (!harvested.length && browser) {
        try {
          const out = await harvestPortable({ browser, job, fields: before.review || [] });
          harvested = out.essays || [];
        } catch (_) {
          harvested = [];
        }
      }
      const rec = store.appendProcessEvent(processUrl, { type: 'submitted', title: 'Applied' });
      const pairs = harvested.map((e) => ({
        label: e.label,
        llm_draft: e.llm_draft || '',
        final: e.final || e.text || '',
        origin: e.origin || '',
        source_card_ids: e.source_card_ids || [],
      }));
      store.writeProcess(processUrl, {
        ...rec,
        jd: jd || rec.jd,
        essays: harvested.length ? harvested : essays || rec.essays,
      });
      if (typeof store.saveLastOutcome === 'function') {
        store.saveLastOutcome({
          kind: 'complete',
          url: processUrl,
          id: job.id,
          snap: snapshotRecord(before),
        });
      }
      let debrief = null;
      const key = chatKeyOf(job.id);
      const messages = store.getChat(key);
      try {
        const voiceDebrief = require('../../../lib/voice-debrief');
        const eligible = voiceDebrief.eligiblePairs(pairs);
        if (eligible.length && llm && typeof llm.prompt === 'function') {
          const prompt = voiceDebrief.buildDebriefOpenPrompt({
            pairs: eligible,
            company: job.company,
            context: {
              voice: store.getVoice(),
              cards: typeof store.cardIndex === 'function' ? store.cardIndex() : [],
              bindings: typeof store.bindingsFor === 'function' ? store.bindingsFor('') : [],
            },
          });
          const out = await llm.prompt({
            mode: 'debrief',
            system: 'Return JSON only. Chat voice, not essay voice.',
            text: prompt,
            job,
          });
          const parsed = voiceDebrief.parseDebriefJson((out && (out.reply || out.text)) || '');
          debrief = await voiceDebrief.runDebriefOpen({ pairs: eligible, parsed, company: job.company });
          const after = store.getProcess(processUrl);
          store.writeProcess(processUrl, {
            ...after,
            debrief: { pairs: eligible, proposed: debrief.proposed, status: debrief.empty ? 'empty' : 'open' },
          });
          messages.push({
            role: 'magnet',
            text: debrief.reply,
            asks: debrief.asks || [],
            kind: 'debrief',
            at: clock.now(),
          });
          store.saveChat(key, messages);
          touchChat(store, key);
        }
      } catch (_) {}
      return {
        ok: true,
        totals: store.bumpTotal('submitted'),
        record: store.getProcess(processUrl),
        undo: true,
        debrief,
        messages,
        harvested,
      };
    },

    passJob({ id, url }) {
      const job = id ? jobOrThrow(id) : { url };
      const before = store.getProcess(job.url || url);
      store.appendProcessEvent(job.url || url, { type: 'passed', title: 'Passed' });
      if (typeof store.saveLastOutcome === 'function') {
        store.saveLastOutcome({
          kind: 'pass',
          url: job.url || url,
          id: job.id,
          snap: snapshotRecord(before),
        });
      }
      return { ok: true, totals: store.bumpTotal('passed'), record: store.getProcess(job.url || url), undo: true };
    },

    undoOutcome() {
      const last = typeof store.lastOutcome === 'function' ? store.lastOutcome() : null;
      if (!last || !last.url) return { ok: false, error: 'nothing to undo' };
      const rec = store.getProcess(last.url);
      store.writeProcess(last.url, revertRecord(rec, eventTypeOf(last.kind), last.snap));
      const kind = countKind(last.kind);
      const totals = store.getTotals();
      if (kind && totals[kind] != null) {
        totals[kind] = Math.max(0, Number(totals[kind]) - 1);
        if (typeof store.setTotals === 'function') store.setTotals(totals);
      }
      if (typeof store.saveLastOutcome === 'function') store.saveLastOutcome(null);
      return { ok: true, record: store.getProcess(last.url), totals: store.getTotals() };
    },

    getProcess({ url, id }) {
      const job = id ? jobOrThrow(id) : { url };
      const record = store.getProcess(job.url || url);
      return { ok: true, record, bucket: filterBucket(record.status), job };
    },

    writeProcess({ url, id, patch }) {
      const job = id ? jobOrThrow(id) : { url };
      return { ok: true, record: store.writeProcess(job.url || url, patch || {}) };
    },

    appendProcessEvent({ url, id, event }) {
      const job = id ? jobOrThrow(id) : { url };
      return { ok: true, record: store.appendProcessEvent(job.url || url, event || {}) };
    },

    addProcessContact({ url, id, contact }) {
      const job = id ? jobOrThrow(id) : { url };
      return { ok: true, record: store.addProcessContact(job.url || url, contact || {}) };
    },

    getTotals() {
      return { ok: true, totals: store.getTotals() };
    },

    getSettings() {
      return { ok: true, settings: store.getSettings(), mail: store.getMailStatus() };
    },

    setSettings(patch) {
      return { ok: true, settings: store.saveSettings(patch) };
    },

    listResumes() {
      return { ok: true, resumes: store.listResumes() };
    },

    importResume(row) {
      return { ok: true, resume: store.importResume(row) };
    },

    pickResume({ id, resumeId }) {
      const job = jobOrThrow(id);
      const resume = store.pickResume(job, resumeId);
      return { ok: Boolean(resume), resume, job };
    },

    async attachResume({ id, resumeId }) {
      const job = jobOrThrow(id);
      const resume = store.pickResume(job, resumeId);
      if (!resume) return { ok: false, error: 'No resume in vault' };
      const browser = browserFor(job.id);
      if (!browser || typeof browser.eval !== 'function') {
        return { ok: false, error: 'No apply page' };
      }
      if (typeof files.attach !== 'function') {
        return { ok: false, error: 'FileInputPort.attach missing' };
      }
      const found = await browser.eval(FIND_FILE_SCRIPT());
      if (!found || !found.ok) return { ok: false, error: 'No resume upload on this page' };
      if (found.already) return { ok: true, already: true, resume };
      const set = await files.attach({
        selector: found.selector,
        resume,
        job,
        magnetInitiated: true,
        eval: (js) => browser.eval(js),
      });
      return { ok: Boolean(set && set.ok !== false), resume, ...(set || {}) };
    },

    getVoice() {
      return { ok: true, voice: store.getVoice() };
    },

    setVoice({ text }) {
      return { ok: true, voice: store.setVoice(text) };
    },

    getSystemPrompt() {
      return { ok: true, systemPrompt: store.getSystemPrompt() };
    },

    setSystemPrompt({ text }) {
      return { ok: true, systemPrompt: store.setSystemPrompt(text) };
    },

    getChat({ id }) {
      const key = chatKeyOf(id);
      return { ok: true, messages: store.getChat(key) };
    },

    getChatUi() {
      const ui = typeof store.getChatUi === 'function' ? store.getChatUi() : chatTabs.emptyUi();
      return { ok: true, ...chatTabs.normalizeUi(ui) };
    },

    selectChat({ key, pageSubtab }) {
      const nextKey = chatKeyOf(key);
      if (typeof store.saveChatUi === 'function') {
        const prev = typeof store.getChatUi === 'function' ? store.getChatUi() : chatTabs.emptyUi();
        store.saveChatUi(chatTabs.selectTab(chatTabs.ensureTab(prev, nextKey), nextKey));
      }
      let sub = pageSubtab ? chatTabs.asPageSubtab(pageSubtab) : '';
      if (chatTabs.isJobKey(nextKey) && typeof store.getChatState === 'function') {
        const state = store.getChatState(nextKey);
        if (!sub) sub = chatTabs.asPageSubtab(state.pageSubtab);
        if (pageSubtab && typeof store.saveChat === 'function') {
          store.saveChat(nextKey, state.messages, { pageSubtab: sub });
        }
      } else if (pageSubtab && chatTabs.isJobKey(nextKey) && typeof store.saveChat === 'function') {
        const messages = store.getChat(nextKey);
        store.saveChat(nextKey, messages, { pageSubtab });
      }
      return { ok: true, ...this.getChatUi(), pageSubtab: sub || undefined };
    },

    getChatState({ id }) {
      const key = chatKeyOf(id);
      if (typeof store.getChatState === 'function') return { ok: true, ...store.getChatState(key) };
      return { ok: true, messages: store.getChat(key), pageSubtab: 'chat' };
    },

    ensureChatTab({ key }) {
      const nextKey = chatKeyOf(key);
      if (typeof store.saveChatUi === 'function') {
        const prev = typeof store.getChatUi === 'function' ? store.getChatUi() : chatTabs.emptyUi();
        store.saveChatUi(chatTabs.ensureTab(prev, nextKey));
      }
      return { ok: true, ...this.getChatUi() };
    },

    async sendChat({ id, text, fieldIds }) {
      const key = chatKeyOf(id);
      const messages = store.getChat(key);
      const you = {
        role: 'you',
        text: String(text || '').trim(),
        at: clock.now(),
        fieldIds: Array.isArray(fieldIds) ? fieldIds : [],
      };
      if (!you.text) return { ok: false, error: 'Empty message' };
      messages.push(you);
      const job = id && id !== '__ingest__' ? store.getJob(id) : null;
      const rec = job ? store.getProcess(job.url) : null;
      let reply = '';
      let drafts = [];
      let asks = [];
      if (rec && rec.debrief && rec.debrief.status === 'open') {
        try {
          const voiceDebrief = require('../../../lib/voice-debrief');
          const choice = voiceDebrief.parseCannedChoice(you.text);
          if (choice) {
            const result = await voiceDebrief.acceptLessons(rec.debrief.proposed, choice, {
              pairs: rec.debrief.pairs,
              userText: you.text,
            });
            if (result.voice && result.voice.text && typeof store.setVoice === 'function') {
              store.setVoice(result.voice.text);
            }
            store.writeProcess(job.url, {
              ...rec,
              debrief: { ...rec.debrief, status: result.skipped ? 'skipped' : 'accepted' },
            });
            reply = voiceDebrief.formatAcceptReply(result, choice);
            messages.push({ role: 'magnet', text: reply, kind: 'debrief', at: clock.now() });
            store.saveChat(key, messages);
            touchChat(store, key);
            return { ok: true, messages, drafts: [], asks: [] };
          }
        } catch (_) {}
      }
      if (typeof llm.prompt === 'function') {
        let prior = '';
        if (typeof store.searchAnswers === 'function' && /use what i wrote|reuse|last (similar|essay)|stripe|prior/i.test(you.text)) {
          const hits = store.searchAnswers({ query: you.text, company: job && job.company, limit: 3 });
          prior = hits
            .map((d) => `${d.company} · ${d.label}\n${String(d.text || '').slice(0, 700)}`)
            .join('\n\n');
        }
        const fields = (rec && rec.review) || [];
        const targeted = you.fieldIds.length
          ? fields.filter((f) => you.fieldIds.includes(f.id))
          : fields.filter((f) => f.reason === 'needs_llm');
        const { isCannedOpenLetter, isReplaceableEssay, coverLetterText } = require('../../../lib/open-letter');
        const canned = targeted.filter((f) => isCannedOpenLetter(f));
        const generate = targeted.filter((f) => !isCannedOpenLetter(f));
        const browser = browserFor(job && job.id);
        for (const field of canned) {
          if (!isReplaceableEssay(field.value || field.current || '')) continue;
          const text = coverLetterText(field.maxlength || field.maxLength);
          drafts.push({ id: field.id, text, label: field.label || '' });
          if (browser && typeof browser.eval === 'function') {
            await browser.eval(simpleFillScript(field.id, text));
          }
        }
        const packRetrieve = retrievePack(store, job, generate.length ? generate : fields, you.text);
        const out = await llm.prompt({
          mode: 'draft',
          system: store.getSystemPrompt(),
          voice: store.getVoice(),
          job,
          fields: generate,
          messages,
          fieldIds: you.fieldIds,
          text: you.text,
          retrieved: prior || packRetrieve.retrieved,
          retrieveCardIds: packRetrieve.retrieveCardIds,
          jd: rec && rec.jd,
          pickBodies: typeof store.pickTurnBodies === 'function' ? (p) => store.pickTurnBodies(p) : undefined,
          store,
        });
        reply = (out && (out.reply || out.text)) || '';
        const cannedIds = new Set(canned.map((f) => f.id));
        const modelDrafts = ((out && out.drafts) || []).filter((d) => d && !cannedIds.has(d.id));
        drafts = drafts.concat(modelDrafts);
        asks = (out && out.asks) || [];
        if (modelDrafts.length && job) {
          const page = browserFor(job.id);
          if (page && typeof page.eval === 'function') {
            for (const draft of modelDrafts) {
              await page.eval(simpleFillScript(draft.id, draft.text));
            }
          }
        }
      } else {
        reply = 'Noted. Connect an LLM port to draft.';
      }
      messages.push({ role: 'magnet', text: reply, drafts, asks, at: clock.now() });
      store.saveChat(key, messages);
      touchChat(store, key);
      return { ok: true, messages, drafts, asks };
    },

    answerChatAsks({ id, answers }) {
      const key = id || '__ingest__';
      const messages = store.getChat(key);
      const text = Array.isArray(answers)
        ? answers.map((a) => `${a.prompt || a.id}: ${a.answer}`).join('\n')
        : String(answers || '');
      messages.push({ role: 'you', text, at: clock.now(), asks: true });
      store.saveChat(key, messages);
      return { ok: true, messages };
    },

    ingest({ text }) {
      const shortcut = mailShortcut(text);
      const messages = store.getChat('__ingest__');
      const body = String(text || '').trim();
      messages.push({ role: 'you', text: body, at: clock.now() });
      touchChat(store, chatTabs.INGEST_KEY);
      if (shortcut) {
        messages.push({
          role: 'magnet',
          text: shortcut.needMailConnect ? 'Opening Gmail…' : 'Scanning inbox…',
          at: clock.now(),
        });
        store.saveChat('__ingest__', messages);
        return { ok: true, added: [], messages, jobs: store.listJobs(), ...shortcut };
      }
      const pending = lastPlan(messages.slice(0, -1));
      if (pending && looksLikeApprove(body)) {
        store.saveChat('__ingest__', messages);
        return app.approveSearch({ schema: pending });
      }
      const urls = urlsFromText(body);
      if (urls.length) {
        const added = [];
        const held = heldSet(store.listJobs(), boardFromUrl);
        let companyHeld = 0;
        urls.forEach((url, i) => {
          if (isHeld({ url }, held, boardFromUrl)) {
            companyHeld += 1;
            return;
          }
          const row = store.upsertJob({ id: `ingest-${clock.now()}-${i}`, url });
          added.push(row);
          for (const key of holdKeys({ url, company: row && row.company }, boardFromUrl)) held.add(key);
          const board = boardFromUrl(url);
          if (board && typeof store.upsertBoard === 'function') store.upsertBoard(board);
        });
        const heldBit = companyHeld ? ` Skipped ${companyHeld} from companies already listed.` : '';
        messages.push({
          role: 'magnet',
          text: `Added ${added.length} job${added.length === 1 ? '' : 's'}.${heldBit}`,
          at: clock.now(),
        });
        store.saveChat('__ingest__', messages);
        return { ok: true, added, messages, jobs: store.listJobs() };
      }
      if (!looksLikeSearch(body) && !pending) {
        messages.push({
          role: 'magnet',
          text: 'Describe the search (title, remote, pay, how many) or paste apply URLs.',
          at: clock.now(),
        });
        store.saveChat('__ingest__', messages);
        return { ok: true, added: [], messages, jobs: store.listJobs() };
      }
      const schema = compileSearchSchema(body, pending);
      const boards = typeof store.listBoards === 'function' ? store.listBoards() : [];
      const reply = schemaReady(schema)
        ? formatPlanReply(schema, boards)
        : 'Need a bit more: title keywords, remote vs on-site, pay floor, or how many jobs.';
      messages.push({
        role: 'magnet',
        text: reply,
        plan: schemaReady(schema) ? schema : null,
        at: clock.now(),
      });
      store.saveChat('__ingest__', messages);
      return {
        ok: true,
        added: [],
        messages,
        jobs: store.listJobs(),
        needApproval: schemaReady(schema),
        schema: schemaReady(schema) ? schema : null,
      };
    },

    async approveSearch({ schema }) {
      const messages = store.getChat('__ingest__');
      const plan = normalizeSchema(schema || lastPlan(messages) || {});
      if (!(Number(plan.n) >= 1)) {
        const text = 'The plan needs a count before Go.';
        messages.push({ role: 'magnet', text, at: clock.now() });
        store.saveChat('__ingest__', messages);
        return { ok: false, missingCount: true, added: [], messages, jobs: store.listJobs() };
      }
      const search = ports.search;
      const huntBrowser = ports.browserHunt || ports.huntBrowser;
      const llmReady = llm && typeof llm.prompt === 'function' && (typeof llm.ready !== 'function' || llm.ready());
      const added = [];
      const seenAdd = new Set();
      const held = heldSet(store.listJobs(), boardFromUrl);
      const takeJob = (j, i) => {
        if (!j || !j.url || seenAdd.has(j.url)) return null;
        if (typeof store.hasJobUrl === 'function' && store.hasJobUrl(j.url, j.linkedin, j.posting)) {
          seenAdd.add(j.url);
          return null;
        }
        if (isHeld(j, held, boardFromUrl)) {
          seenAdd.add(j.url);
          return { companyHeld: true };
        }
        seenAdd.add(j.url);
        const row = store.upsertJob({
          id: j.id || `search-${clock.now()}-${i || added.length}`,
          url: j.url,
          company: j.company,
          title: j.title,
          salary: j.salary,
          yoe: j.yoe,
          level: j.level,
          industries: j.industries,
          skills: j.skills,
          posting: j.posting || j.url,
          linkedin: j.linkedin,
        });
        added.push(row);
        for (const key of holdKeys(row, boardFromUrl)) held.add(key);
        const patch = {};
        if (j.jdText && pageJdReady(j.jdText)) patch.jd = { text: j.jdText, source: j.jdSource || 'search' };
        if (j.salary) patch.salary = j.salary;
        if (Object.keys(patch).length) store.writeProcess(row.url, patch);
        return row;
      };
      let found = { ok: false, jobs: [], needBoards: false };
      if (typeof search === 'function') {
        found = (await search(plan)) || found;
      } else if (search && typeof search.execute === 'function') {
        found = (await search.execute(plan)) || found;
      } else {
        const boards = typeof store.listBoards === 'function' ? store.listBoards() : [];
        const jsonFound = await huntJobs({
          boards,
          extraJobs: store.listJobs(),
          schema: plan,
          fetch: typeof ports.fetch === 'function' ? ports.fetch : globalThis.fetch,
        });
        (jsonFound.jobs || []).forEach((j, i) => takeJob(j, i));
        const remain = Math.max(0, plan.n - added.length);
        if (remain > 0 && huntBrowser && llmReady) {
          found = await runJsonHunt({
            schema: { ...plan, n: remain },
            starts: huntStartUrls(plan, { boards }),
            existingUrls: store.listJobs().map((j) => j.url),
            existingJobs: store.listJobs(),
            browser: huntBrowser,
            llm,
            onNeedLogin: ports.onHuntLogin,
            onProgress: (text) => {
              messages.push({ role: 'magnet', text: String(text), at: clock.now() });
              store.saveChat('__ingest__', messages);
              if (typeof ports.onHuntProgress === 'function') ports.onHuntProgress(text, messages.slice());
            },
            onAdd: (job) => takeJob(job),
          });
        } else {
          found = jsonFound;
        }
      }
      const rows = Array.isArray(found.jobs) ? found.jobs : [];
      rows.forEach((j, i) => takeJob(j, i));
      const reply =
        found.needBoards && !added.length
          ? 'No ATS boards on this device yet. Paste Greenhouse / Ashby / Lever URLs, or run Go where Magnet can drive a signed-in browser.'
          : found.reply || `Added ${added.length} job${added.length === 1 ? '' : 's'}.`;
      messages.push({
        role: 'magnet',
        text: reply,
        plan: null,
        at: clock.now(),
      });
      store.saveChat('__ingest__', messages);
      return {
        ok: true,
        added,
        messages,
        jobs: store.listJobs(),
        needBoards: Boolean(found.needBoards) && !added.length,
        schema: plan,
      };
    },

    async inventory({ id }) {
      const job = jobOrThrow(id);
      const browser = browserFor(job.id);
      if (!browser || typeof browser.inventory !== 'function' && typeof browser.eval !== 'function') {
        return { ok: false, error: 'No apply page' };
      }
      if (typeof browser.inventory === 'function') {
        const fields = await browser.inventory();
        return { ok: true, fields: fields || [], job };
      }
      return { ok: true, fields: [], job };
    },

    async runAutofill({ id, stage, onStep, chain }) {
      fillCancelled = false;
      const job = jobOrThrow(id);
      const rec = store.getProcess(job.url);
      const browser = browserFor(job.id);
      if (fillCancelled) return { ok: true, cancelled: true };

      let attached = null;
      if (!stage || stage === 'resume' || stage === 'all') {
        attached = await app.attachResume({ id: job.id });
        if (stage === 'resume') {
          emitStep(onStep, 'Done', { detail: '' });
          return { ok: attached.ok, stage: 'resume', attached };
        }
      }

      store.appendProcessEvent(job.url, { type: 'autofill', title: 'Autofill' });
      const out = await runPortableAutofill({
        job,
        rec,
        browser,
        files,
        llm,
        store,
        stage,
        chain,
        onStep,
        signal: { get cancelled() { return fillCancelled; } },
      });
      if (attached) out.attached = attached;
      if (out && out.leftovers) {
        const cur = store.getProcess(job.url);
        store.writeProcess(job.url, { ...cur, review: out.leftovers });
      }
      return out;
    },

    cancelFill() {
      fillCancelled = true;
      return { ok: true, cancelled: true };
    },

    getReview({ id }) {
      const job = id ? jobOrThrow(id) : null;
      const rec = job ? store.getProcess(job.url) : null;
      return { ok: true, leftovers: (rec && rec.review) || [], id };
    },

    async acceptReview({ id, fieldId, value, label, skip, steps, recipe }) {
      const job = jobOrThrow(id);
      if (label || fieldId) {
        store.confirmClass(String(label || fieldId), value, { source: 'accept', label });
      }
      if (recipe) store.saveRecipe(recipe);
      const rec = store.getProcess(job.url);
      const leftovers = (rec.review || []).filter((row) => row.id !== fieldId);
      store.writeProcess(job.url, { ...rec, review: leftovers });
      if (!skip && value != null) {
        const browser = browserFor(job.id);
        if (browser && typeof browser.eval === 'function') {
          await browser.eval(simpleFillScript(fieldId, value));
        }
      }
      return { ok: true, id, fieldId, value, leftovers };
    },

    learnRecipe({ recipe }) {
      return { ok: true, recipe: store.saveRecipe(recipe || {}) };
    },

    answerReviewAsk({ id, askId, answer }) {
      return { ok: true, id, askId, answer };
    },

    exportBundle() {
      return { ok: true, bundle: store.exportBundle() };
    },

    importBundle({ bundle }) {
      return { ok: true, ...(store.importBundle(bundle) || {}) };
    },

    mailStatus() {
      return { ok: true, mail: store.getMailStatus(), queue: store.getMailQueue() };
    },

    async mailConnect() {
      if (typeof mail.connect === 'function') {
        const out = await mail.connect();
        if (out && out.needUi) return { ok: false, needUi: true };
        store.setMailStatus({ connected: Boolean(out && out.ok !== false), email: (out && out.email) || '' });
        return { ok: true, ...(out || {}) };
      }
      return { ok: false, error: 'MailPort.connect is not configured. Import messages or connect a mailbox.' };
    },

    async mailSignOut() {
      if (typeof mail.signOut === 'function') await mail.signOut();
      store.setMailStatus({ connected: false, email: '' });
      return { ok: true, mail: store.getMailStatus() };
    },

    async mailScan() {
      if (typeof mail.scan === 'function') {
        const out = await mail.scan({ jobs: store.listJobs(), seen: (store.getSettings().gmailSeen) || {} });
        if (Array.isArray(out && out.messages) && out.messages.length) {
          const imported = app.mailImport({ messages: out.messages });
          if (out.seen) store.saveSettings({ gmailSeen: out.seen });
          const queued = (imported.queued || []).length;
          return {
            ok: true,
            ...imported,
            scanned: out.messages.length,
            reply: queued ? `Scanned ${out.messages.length}. ${queued} need you — Jobs bell` : `Scanned ${out.messages.length}.`,
          };
        }
        return { ok: true, ...(out || {}) };
      }
      return { ok: true, scanned: 0, queue: store.getMailQueue() };
    },

    mailImport({ messages }) {
      const jobs = store.listJobs();
      const queued = [];
      for (const msg of messages || []) {
        const reviewed = reviewMessage(msg, jobs);
        const verdict = reviewed.verdict && reviewed.verdict.verdict;
        if (verdict === 'noise' || verdict === 'not_reject' || verdict === 'received') continue;
        const item = {
          id: msg.id || `mail-${clock.now()}-${queued.length}`,
          subject: msg.subject || '',
          from: msg.from || '',
          text: msg.text || '',
          snippet: msg.snippet || '',
          verdict: reviewed.verdict,
          decision: reviewed.decision,
          candidates: (reviewed.decision && reviewed.decision.candidates) || [],
          reason: (reviewed.decision && reviewed.decision.reason) || '',
        };
        if (reviewed.decision.action === 'reject' && reviewed.decision.url) {
          store.appendProcessEvent(reviewed.decision.url, { type: 'rejected', title: 'Rejected', body: msg.subject || '' });
          store.bumpTotal('rejected');
        } else if (reviewed.decision.action !== 'ignore' && reviewed.decision.action !== 'skip') {
          store.addMailItem(item);
          queued.push(item);
        }
      }
      store.setMailStatus({ scanned_at: new Date(clock.now()).toISOString(), indexed: (messages || []).length });
      const notices = notifyQueuedMail(store, queued, clock);
      return { ok: true, queued, notices, mail: store.getMailStatus() };
    },

    mailResolve({ id, action, url }) {
      const item = store.getMailQueue().find((m) => m.id === String(id));
      if (action === 'reject' && url) {
        store.appendProcessEvent(url, { type: 'rejected', title: 'Rejected' });
        store.bumpTotal('rejected');
      } else if (action === 'interview' && url) {
        store.appendProcessEvent(url, { type: 'recruiter_screen', title: 'Interview' });
      }
      store.removeMailItem(id);
      if (id) {
        for (const row of chatRows(store)) {
          store.saveChat(row.key, markMailRead(row.messages, id));
        }
      }
      return { ok: true, item, mail: store.getMailStatus(), queue: store.getMailQueue() };
    },

    listNotices() {
      return { ok: true, notices: unreadMailNotices(chatRows(store), store.listJobs()) };
    },

    markNoticeRead({ mailId, key }) {
      const id = String(mailId || '');
      if (!id) return { ok: false, error: 'missing mailId' };
      const rows = key
        ? [{ key, messages: store.getChat(key) }]
        : chatRows(store);
      for (const row of rows) {
        store.saveChat(row.key, markMailRead(row.messages, id));
      }
      return { ok: true, notices: unreadMailNotices(chatRows(store), store.listJobs()) };
    },

    getProfile() {
      return { ok: true, profile: store.getProfile() };
    },
  };

  return app;
}

module.exports = { createMagnetApp, FIND_FILE_SCRIPT, simpleFillScript, mailShortcut };
