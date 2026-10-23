const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const store = require('../../../lib/store');
const { shapeJob, filterBucket, urlKeys } = require('../../core/src/jobs');
const { emptyProcess, applyProcessEvent } = require('../../core/src/memory-store');
const jobsFile = require('../../../lib/jobs-file');
const { canonicalUrl, indexJobs, sameUrl } = require('../../../lib/job-identity');
const applicationState = require('../../../lib/application-state');
const settingsMod = require('../../../lib/settings');
const { loadRichboi, saveRichboi, loadSystemPrompt, saveSystemPrompt } = require('../../../lib/essay-prompt');
const profileFacts = require('../../../lib/profile-facts');
const { applyConfirm, applyContradict, listAnswers } = require('../../../lib/confirmations');
const chatTabs = require('../../../lib/chat-tabs');
const sidebarFilters = require('../../../lib/sidebar-filters');

function knowledgeDir() {
  return process.env.MAGNET_KNOWLEDGE || path.join(__dirname, '..', '..', '..', 'knowledge');
}

function vaultDir() {
  return path.join(knowledgeDir(), 'resumes');
}

function resumesYamlPath() {
  return path.join(knowledgeDir(), 'resumes.yaml');
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

function open(file) {
  store.open(file);
  return api();
}

function kvGet(key, fallback) {
  const row = store.queryOne('SELECT value FROM kv WHERE key = ?', [key]);
  return row ? parseJson(row.value, fallback) : fallback;
}

function kvSet(key, value) {
  store.exec('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    json(value),
  ]);
}

function kvDel(key) {
  store.exec('DELETE FROM kv WHERE key = ?', [key]);
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

function writeJobsYaml(jobs, dir) {
  const file = path.join(dir || knowledgeDir(), 'jobs.yaml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev = {};
  try {
    if (fs.existsSync(file)) prev = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    prev = {};
  }
  const prevJobs = Array.isArray(prev.jobs) ? prev.jobs : [];
  const prevIndex = indexJobs(prevJobs);
  const dumped = (jobs || []).map((job) => {
    const copy = { ...job, name: undefined };
    delete copy.sortIndex;
    delete copy.updatedAt;
    const old = sameUrl(copy, prevIndex);
    if (old) {
      if (old.agent) copy.agent = true;
      if (old.id && /^agent-/.test(String(old.id))) copy.id = old.id;
      if (old.submitted_at && !copy.submitted_at) copy.submitted_at = old.submitted_at;
      if (old.location && !copy.location) copy.location = old.location;
    }
    return copy;
  });
  const seen = new Set(dumped.map((job) => canonicalUrl(job && job.url)).filter(Boolean));
  for (const old of prevJobs) {
    if (!old || !old.agent) continue;
    const key = canonicalUrl(old.url);
    if (key && !seen.has(key)) {
      dumped.push(old);
      seen.add(key);
    }
  }
  const doc = {};
  if (prev.meta) doc.meta = prev.meta;
  doc.jobs = dumped;
  if (Array.isArray(prev.bugs)) doc.bugs = prev.bugs;
  if (Array.isArray(prev.blockers)) doc.blockers = prev.blockers;
  const body = yaml.dump(doc, { lineWidth: 100, noRefs: true, sortingKeys: false });
  fs.writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
}

function loadProcessYaml(dir) {
  const file = path.join(dir, 'process.yaml');
  try {
    if (!fs.existsSync(file)) return { by_url: {} };
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    return { by_url: doc.by_url && typeof doc.by_url === 'object' ? doc.by_url : {} };
  } catch {
    return { by_url: {} };
  }
}

function loadChatsYaml(dir) {
  const file = path.join(dir, 'archive', 'chats.json');
  try {
    if (!fs.existsSync(file)) return { by_url: {}, ui: null };
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    return {
      by_url: doc.by_url && typeof doc.by_url === 'object' ? doc.by_url : {},
      ui: doc.ui && typeof doc.ui === 'object' ? doc.ui : null,
    };
  } catch {
    return { by_url: {}, ui: null };
  }
}

function chatPayloadFromDb(raw) {
  const parsed = typeof raw === 'string' ? parseJson(raw, []) : raw;
  if (Array.isArray(parsed)) {
    return {
      messages: parsed,
      folded: [],
      agentId: '',
      snapshotKey: '',
      company: '',
      title: '',
      pageSubtab: 'chat',
    };
  }
  if (parsed && typeof parsed === 'object') {
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      folded: Array.isArray(parsed.folded) ? parsed.folded : [],
      agentId: String(parsed.agentId || ''),
      snapshotKey: String(parsed.snapshotKey || ''),
      company: String(parsed.company || ''),
      title: String(parsed.title || ''),
      pageSubtab: chatTabs.asPageSubtab(parsed.pageSubtab),
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

function writeChatRow(key, payload) {
  store.exec(
    'INSERT INTO chats(key, messages, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET messages=excluded.messages, updated_at=excluded.updated_at',
    [String(key), json(payload || chatPayloadFromDb(null)), new Date().toISOString()]
  );
}

function writeResumesYaml(rows) {
  const dest = resumesYamlPath();
  fs.writeFileSync(
    dest,
    yaml.dump(
      {
        resumes: rows.map((r) => ({
          id: r.id,
          label: r.label,
          path: r.rel_path || r.relPath || `resumes/${r.filename}`,
          match: parseJson(r.match_patterns, r.match || []),
        })),
      },
      { lineWidth: 100, noRefs: true, sortingKeys: false }
    ),
    'utf8'
  );
}

function listJobRows() {
  return store.query('SELECT * FROM jobs ORDER BY sort_index, id').map(rowToJob);
}

function upsertJobRow(job, index = 0) {
  const row = shapeJob(job, index);
  store.exec(
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
      index,
      new Date().toISOString(),
    ]
  );
  return row;
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

function writeProcessRow(url, rec) {
  store.exec(
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
      new Date().toISOString(),
    ]
  );
  return rec;
}

function listResumeRows() {
  return store.query('SELECT * FROM resumes ORDER BY is_default DESC, id').map((row) => ({
    id: row.id,
    label: row.label,
    filename: row.filename,
    mime: row.mime || 'application/pdf',
    match: parseJson(row.match_patterns, []),
    isDefault: Boolean(row.is_default),
    relPath: row.rel_path,
    abs: row.rel_path ? path.join(knowledgeDir(), row.rel_path) : '',
    importedAt: row.imported_at,
  }));
}

function copyIntoVault(abs, id, filename) {
  fs.mkdirSync(vaultDir(), { recursive: true });
  const ext = path.extname(filename || abs || '.pdf') || '.pdf';
  const destName = `${id}${ext}`;
  const dest = path.join(vaultDir(), destName);
  if (abs && fs.existsSync(abs) && path.resolve(abs) !== path.resolve(dest)) {
    fs.copyFileSync(abs, dest);
  }
  return { dest, relPath: `resumes/${destName}`, filename: destName };
}

function importResumeRow(row) {
  const id = String(row.id || `resume-${Date.now()}`);
  const filename = path.basename(row.filename || row.path || `${id}.pdf`);
  let relPath = row.relPath || row.rel_path || '';
  let abs = row.abs || '';
  if (row.bytes) {
    fs.mkdirSync(vaultDir(), { recursive: true });
    const destName = `${id}${path.extname(filename) || '.pdf'}`;
    const dest = path.join(vaultDir(), destName);
    const buf = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(String(row.bytes), 'base64');
    fs.writeFileSync(dest, buf);
    relPath = `resumes/${destName}`;
    abs = dest;
  } else if (abs && fs.existsSync(abs)) {
    const copied = copyIntoVault(abs, id, filename);
    relPath = copied.relPath;
    abs = copied.dest;
  } else if (relPath) {
    abs = path.join(knowledgeDir(), relPath);
  }
  store.exec(
    `INSERT INTO resumes(id, label, filename, mime, match_patterns, is_default, rel_path, imported_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       label=excluded.label, filename=excluded.filename, mime=excluded.mime,
       match_patterns=excluded.match_patterns, is_default=excluded.is_default,
       rel_path=excluded.rel_path, imported_at=excluded.imported_at`,
    [
      id,
      row.label || filename,
      path.basename(relPath || filename),
      row.mime || 'application/pdf',
      json(row.match || []),
      row.isDefault || id === 'default' ? 1 : 0,
      relPath,
      row.importedAt || new Date().toISOString(),
    ]
  );
  const rows = listResumeRows();
  writeResumesYaml(store.query('SELECT * FROM resumes'));
  return rows.find((r) => r.id === id);
}

function migrateFromYaml(root) {
  if (require('../../../lib/store/mode').isSupabase()) return api();
  const dir = root || knowledgeDir();
  const existing = store.queryOne('SELECT COUNT(*) AS n FROM jobs');
  if (!existing || !existing.n) {
    const file = path.join(dir, 'jobs.yaml');
    if (fs.existsSync(file)) {
      jobsFile.loadJobsFile(file).forEach((job, i) => upsertJobRow(job, i));
    }
  }
  const processDoc = loadProcessYaml(dir);
  for (const [url, rec] of Object.entries(processDoc.by_url || {})) {
    const have = store.queryOne('SELECT url FROM process_records WHERE url = ?', [url]);
    if (!have) writeProcessRow(url, { ...emptyProcess(), ...rec });
  }
  const chatsDoc = loadChatsYaml(dir);
  for (const [key, row] of Object.entries(chatsDoc.by_url || {})) {
    const have = store.queryOne('SELECT key FROM chats WHERE key = ?', [String(key)]);
    if (have) continue;
    writeChatRow(key, chatPayloadFromDb(row));
  }
  if (chatsDoc.ui && !kvGet('chatUi', null)) kvSet('chatUi', chatTabs.normalizeUi(chatsDoc.ui));
  const totals = applicationState.loadState().totals;
  kvSet('totals', totals);
  kvSet('settings', settingsMod.load());
  try {
    kvSet('profile', profileFacts.load());
  } catch (_) {}
  kvSet('voice', loadRichboi());
  kvSet('systemPrompt', loadSystemPrompt());

  const yamlResumes = path.join(dir, 'resumes.yaml');
  const haveResume = store.queryOne('SELECT COUNT(*) AS n FROM resumes');
  if ((!haveResume || !haveResume.n) && fs.existsSync(yamlResumes)) {
    const doc = yaml.load(fs.readFileSync(yamlResumes, 'utf8')) || {};
    for (const row of doc.resumes || []) {
      const abs = path.resolve(path.dirname(yamlResumes), row.path);
      importResumeRow({
        id: row.id,
        label: row.label,
        filename: path.basename(row.path || 'resume.pdf'),
        match: row.match || [],
        isDefault: row.id === 'default',
        abs: fs.existsSync(abs) ? abs : '',
      });
    }
  }
  return api();
}

function exportLiveYaml(root) {
  const dir = root || knowledgeDir();
  open();
  fs.mkdirSync(dir, { recursive: true });
  writeJobsYaml(listJobRows(), dir);
  const byUrl = {};
  for (const r of store.query('SELECT * FROM process_records')) {
    byUrl[r.url] = processFromRow(r);
  }
  fs.writeFileSync(
    path.join(dir, 'process.yaml'),
    yaml.dump({ by_url: byUrl }, { lineWidth: 100, noRefs: true, sortingKeys: false }),
    'utf8'
  );
  const chatsBy = {};
  for (const r of store.query('SELECT * FROM chats')) {
    chatsBy[r.key] = chatPayloadFromDb(r.messages);
  }
  const archive = path.join(dir, 'archive');
  fs.mkdirSync(archive, { recursive: true });
  fs.writeFileSync(
    path.join(archive, 'chats.json'),
    JSON.stringify({ by_url: chatsBy, ui: kvGet('chatUi', chatTabs.emptyUi()) }, null, 2)
  );
  return { jobs: listJobRows().length, process: Object.keys(byUrl).length, chats: Object.keys(chatsBy).length };
}

function nextSortIndex() {
  const row = store.queryOne('SELECT COALESCE(MAX(sort_index), -1) AS n FROM jobs');
  return Number(row && row.n) + 1;
}

function hasJobUrl(...vals) {
  const urls = urlKeys(...vals);
  if (!urls.length) return false;
  const ph = urls.map(() => '?').join(',');
  return Boolean(
    store.queryOne(
      `SELECT 1 AS ok FROM jobs WHERE url IN (${ph}) OR linkedin IN (${ph}) OR posting IN (${ph}) LIMIT 1`,
      [...urls, ...urls, ...urls]
    )
  );
}

function sqliteNodeStore() {
  return {
    listJobs() {
      return listJobRows().map((job) => {
        const rec = processFromRow(store.queryOne('SELECT * FROM process_records WHERE url = ?', [job.url]));
        return {
          ...job,
          status: rec.status || 'open',
          bucket: filterBucket(rec.status),
          updatedAt: sidebarFilters.updatedAt(job, rec),
        };
      });
    },
    hasJobUrl,
    upsertJob(job) {
      return upsertJobRow(job, nextSortIndex());
    },
    removeJob(id) {
      store.exec('DELETE FROM jobs WHERE id = ?', [String(id)]);
      return { ok: true };
    },
    getJob(id) {
      return rowToJob(store.queryOne('SELECT * FROM jobs WHERE id = ?', [String(id)]));
    },
    getProcess(url) {
      return processFromRow(store.queryOne('SELECT * FROM process_records WHERE url = ?', [url]));
    },
    hasProcess(url) {
      return Boolean(store.queryOne('SELECT url FROM process_records WHERE url = ?', [String(url)]));
    },
    writeProcess(url, patch) {
      const prev = this.getProcess(url);
      return writeProcessRow(url, { ...prev, ...patch });
    },
    appendProcessEvent(url, event) {
      return writeProcessRow(url, applyProcessEvent(this.getProcess(url), event));
    },
    addProcessContact(url, contact) {
      const rec = this.getProcess(url);
      rec.contacts = [...(rec.contacts || []), { id: contact.id || `c-${Date.now()}`, ...contact }];
      return writeProcessRow(url, rec);
    },
    getTotals() {
      return kvGet('totals', applicationState.loadState().totals);
    },
    bumpTotal(kind) {
      const totals = applicationState.bump(kind);
      kvSet('totals', totals);
      return totals;
    },
    getSettings() {
      return kvGet('settings', settingsMod.load());
    },
    saveSettings(patch) {
      const next = settingsMod.save(patch);
      kvSet('settings', next);
      return next;
    },
    listResumes: listResumeRows,
    importResume: importResumeRow,
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
      return kvGet('voice', loadRichboi());
    },
    setVoice(text) {
      const next = saveRichboi(text);
      kvSet('voice', next);
      return next;
    },
    getSystemPrompt() {
      return kvGet('systemPrompt', loadSystemPrompt());
    },
    setSystemPrompt(text) {
      const next = saveSystemPrompt(text);
      kvSet('systemPrompt', next);
      return next;
    },
    getChat(key) {
      return this.getChatState(key).messages;
    },
    getChatState(key) {
      const row = store.queryOne('SELECT messages FROM chats WHERE key = ?', [String(key)]);
      if (!row) {
        return {
          messages: [],
          folded: [],
          agentId: '',
          snapshotKey: '',
          company: '',
          title: '',
          pageSubtab: 'chat',
          url: String(key),
        };
      }
      return { url: String(key), ...chatPayloadFromDb(row.messages) };
    },
    listChats() {
      return store.query('SELECT key, messages FROM chats').map((r) => {
        const payload = chatPayloadFromDb(r.messages);
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
      const prev = this.getChatState(key);
      const fromObject = messages && !Array.isArray(messages) && typeof messages === 'object';
      const payload = fromObject
        ? { ...prev, ...chatPayloadFromDb(messages), url: undefined }
        : {
            messages: Array.isArray(messages) ? messages : [],
            folded: meta.folded !== undefined ? meta.folded : prev.folded,
            agentId: meta.agentId !== undefined ? String(meta.agentId) : prev.agentId,
            snapshotKey: meta.snapshotKey !== undefined ? String(meta.snapshotKey) : prev.snapshotKey,
            company: meta.company !== undefined ? String(meta.company) : prev.company,
            title: meta.title !== undefined ? String(meta.title) : prev.title,
            pageSubtab: meta.pageSubtab !== undefined ? chatTabs.asPageSubtab(meta.pageSubtab) : prev.pageSubtab,
          };
      writeChatRow(key, payload);
      return payload.messages;
    },
    getConfirmations() {
      return listAnswers(this.getProfile());
    },
    confirmClass(classId, value, extra) {
      const { doc, row } = applyConfirm(this.getProfile(), classId, value, extra);
      this.setProfile(doc);
      return row;
    },
    listRecipes() {
      return store.query('SELECT * FROM recipe_items').map((r) => parseJson(r.payload, {}));
    },
    saveRecipe(recipe) {
      const id = String((recipe && recipe.id) || `recipe-${Date.now()}`);
      const row = { ...recipe, id };
      store.exec(
        'INSERT INTO recipe_items(id, payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [id, json(row)]
      );
      return row;
    },
    getProfile() {
      try {
        return kvGet('profile', profileFacts.load());
      } catch {
        return kvGet('profile', {});
      }
    },
    setProfile(profile) {
      kvSet('profile', profile);
      return profile;
    },
    getMailQueue() {
      return store.query('SELECT * FROM mail_items ORDER BY created_at').map((r) => parseJson(r.payload, {}));
    },
    addMailItem(item) {
      const row = { id: item.id || `mail-${Date.now()}`, ...item };
      store.exec('INSERT INTO mail_items(id, payload, created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', [
        row.id,
        json(row),
        new Date().toISOString(),
      ]);
      return row;
    },
    removeMailItem(id) {
      store.exec('DELETE FROM mail_items WHERE id = ?', [String(id)]);
      return this.getMailQueue();
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
      return kvGet('mailStatus', { connected: false, email: '', scanned_at: null, indexed: 0, pending: 0 });
    },
    setMailStatus(patch) {
      const next = { ...this.getMailStatus(), ...patch };
      kvSet('mailStatus', next);
      return next;
    },
    exportBundle() {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        jobs: listJobRows(),
        process: { by_url: Object.fromEntries(store.query('SELECT * FROM process_records').map((r) => [r.url, processFromRow(r)])) },
        totals: this.getTotals(),
        settings: this.getSettings(),
        resumes: listResumeRows().map((r) => ({
          ...r,
          bytes: r.abs && fs.existsSync(r.abs) ? fs.readFileSync(r.abs).toString('base64') : null,
          abs: undefined,
        })),
        chats: {
          by_url: Object.fromEntries(
            store.query('SELECT * FROM chats').map((r) => [r.key, chatPayloadFromDb(r.messages)])
          ),
          ui: this.getChatUi(),
        },
        voice: this.getVoice(),
        systemPrompt: this.getSystemPrompt(),
        confirmations: this.getConfirmations(),
        recipes: this.listRecipes(),
        profile: this.getProfile(),
        mail: { queue: this.getMailQueue(), status: this.getMailStatus() },
        huntSession: this.getHuntSession(),
        boards: kvGet('boards', []),
        graph: {
          cards: store.query('SELECT * FROM cards'),
          card_tags: store.query('SELECT * FROM card_tags'),
          bindings: store.query('SELECT * FROM bindings'),
          timeline: store.query('SELECT * FROM timeline'),
          voice_versions: store.query('SELECT * FROM voice_versions'),
        },
      };
    },
    exportLiveYaml() {
      return exportLiveYaml();
    },
    importBundle(bundle) {
      if (!bundle || typeof bundle !== 'object') throw new Error('Invalid bundle');
      if (Array.isArray(bundle.jobs)) {
        store.exec('DELETE FROM jobs');
        bundle.jobs.forEach((job, i) => upsertJobRow(job, i));
      }
      if (bundle.process && bundle.process.by_url) {
        for (const [url, rec] of Object.entries(bundle.process.by_url)) writeProcessRow(url, { ...emptyProcess(), ...rec });
      }
      if (bundle.totals) kvSet('totals', bundle.totals);
      if (bundle.settings) this.saveSettings(bundle.settings);
      if (Array.isArray(bundle.resumes)) bundle.resumes.forEach((r) => importResumeRow(r));
      if (bundle.chats && bundle.chats.by_url) {
        for (const [key, messages] of Object.entries(bundle.chats.by_url)) this.saveChat(key, messages);
      }
      if (bundle.chats && bundle.chats.ui) this.saveChatUi(bundle.chats.ui);
      if (bundle.voice != null) this.setVoice(bundle.voice);
      if (bundle.systemPrompt != null) this.setSystemPrompt(bundle.systemPrompt);
      if (bundle.profile) this.setProfile(bundle.profile);
      if (Array.isArray(bundle.confirmations)) {
        let profile = this.getProfile();
        for (const item of bundle.confirmations) {
          if (!item || !item.class) continue;
          if (item.confidence === 'contradicted') profile = applyContradict(profile, item.class, item).doc;
          else if (item.value != null && String(item.value).trim()) {
            profile = applyConfirm(profile, item.class, item.value, item).doc;
          }
        }
        this.setProfile(profile);
      }
      if (bundle.mail) {
        if (Array.isArray(bundle.mail.queue)) bundle.mail.queue.forEach((item) => this.addMailItem(item));
        if (bundle.mail.status) this.setMailStatus(bundle.mail.status);
      }
      if (bundle.huntSession !== undefined) this.saveHuntSession(bundle.huntSession);
      if (Array.isArray(bundle.boards) && bundle.boards.length) kvSet('boards', bundle.boards);
      if (bundle.graph) {
        const { createSqlStore } = require('../../core/src/sql-store');
        createSqlStore(store).importGraph(bundle.graph);
      }
      return { ok: true, jobs: listJobRows().length };
    },
    listBoards() {
      return kvGet('boards', []);
    },
    upsertBoard(partial, company) {
      const { upsertBoardList } = require('../../core/src/boards');
      const next = upsertBoardList(kvGet('boards', []), partial, company);
      kvSet('boards', next);
      return next[next.length - 1] || null;
    },
  };
}

function nodeStore() {
  if (require('../../../lib/store/mode').storeMode() === 'supabase') {
    return require('./pg-store').createNodeStore();
  }
  return sqliteNodeStore();
}

function api() {
  return Object.assign(nodeStore(), { open, migrateFromYaml, exportLiveYaml, knowledgeDir, vaultDir });
}

module.exports = {
  open,
  migrateFromYaml,
  exportLiveYaml,
  knowledgeDir,
  vaultDir,
  nodeStore,
  importResume: importResumeRow,
  listResumes: listResumeRows,
  copyIntoVault,
};
