/** Supabase persist (PostgREST via MAGNET_STORE=supabase). Not a Postgres client. */
const fs = require('fs');
const path = require('path');
const store = require('../../../lib/store');
const { shapeJob, filterBucket, urlKeys } = require('../../core/src/jobs');
const { emptyProcess, applyProcessEvent } = require('../../core/src/memory-store');
const { canonicalUrl } = require('../../../lib/job-identity');
const settingsMod = require('../../../lib/settings');
const { applyConfirm, applyContradict, listAnswers } = require('../../../lib/confirmations');
const chatTabs = require('../../../lib/chat-tabs');
const sidebarFilters = require('../../../lib/sidebar-filters');
const storage = require('../../../lib/store/storage');

const STATUSES = new Set(['open', 'submitted', 'passed', 'rejected', 'withdrawn', 'interviewing', 'offer']);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asDate(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function strategyFromRows(scores, prints) {
  const fingerprints = {};
  const byFingerprint = new Map();
  for (const score of scores || []) {
    const list = byFingerprint.get(score.fingerprint);
    if (list) list.push(score);
    else byFingerprint.set(score.fingerprint, [score]);
  }
  for (const row of prints || []) {
    const strategies = {};
    for (const score of byFingerprint.get(row.fingerprint) || []) {
      strategies[score.strategy] = {
        wins: score.wins,
        losses: score.losses,
        last_verified_at: score.last_verified_at,
      };
    }
    fingerprints[row.fingerprint] = {
      strategies,
      last_success: row.last_success,
      human_flags: asArray(row.human_flags),
    };
  }
  return { version: 1, fingerprints };
}

function strategyRows(doc) {
  const prints = [];
  const scores = [];
  const now = new Date().toISOString();
  for (const [fingerprint, row] of Object.entries((doc && doc.fingerprints) || {})) {
    prints.push({
      fingerprint,
      last_success: (row && row.last_success) || null,
      human_flags: asArray(row && row.human_flags),
      updated_at: now,
    });
    for (const [strategy, score] of Object.entries((row && row.strategies) || {})) {
      scores.push({
        fingerprint,
        strategy,
        wins: Number(score && score.wins) || 0,
        losses: Number(score && score.losses) || 0,
        last_verified_at: (score && score.last_verified_at) || null,
      });
    }
  }
  return { prints, scores };
}

/** jsonb columns reject a bare string. Objects are stringified later by the pg worker. */
function jsonParam(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return value;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function nextJobId() {
  for (let n = 0; n < 8; n++) {
    const id = `tab-${Date.now().toString(36)}${n ? n : ''}`;
    if (id === 'tab-0') continue;
    const hit = store.queryOne('SELECT id FROM jobs WHERE id = ?', [id]);
    if (!hit) return id;
  }
  return `tab-${Date.now()}`;
}

function jobFromRow(row) {
  if (!row) return null;
  const job = shapeJob(
    {
      ...row,
      industries: asArray(row.industries),
      skills: asArray(row.skills),
    },
    row.sort_index || 0
  );
  job.location = row.location || '';
  job.sortIndex = Number(row.sort_index) || 0;
  job.updatedAt = row.updated_at || '';
  return job;
}

function statusOf(value) {
  const status = String(value || 'open');
  return STATUSES.has(status) ? status : 'open';
}

function ensureApplication(url, patch = {}) {
  const canon = canonicalUrl(url);
  if (!canon) throw new Error('application url required');
  const job = store.queryOne('SELECT id FROM jobs WHERE canonical_url = ? OR url = ? LIMIT 1', [canon, url]);
  const existing = store.queryOne('SELECT * FROM applications WHERE canonical_url = ?', [canon]);
  const now = new Date().toISOString();
  if (!existing) {
    store.exec(
      `INSERT INTO applications (job_id, url, canonical_url, status, source, submitted_at, rejected_at, passed_at, prep_notes, jd, posting, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        (patch.job_id || (job && job.id) || null),
        url,
        canon,
        statusOf(patch.status),
        patch.source || 'manual',
        patch.submitted_at || null,
        patch.rejected_at || null,
        patch.passed_at || null,
        patch.prep_notes || '',
        jsonParam(patch.jd),
        jsonParam(patch.posting),
        now,
      ]
    );
  }
  return store.queryOne('SELECT * FROM applications WHERE canonical_url = ?', [canon]);
}

function processFromParts(row, events, contacts, essays) {
  if (!row) return emptyProcess();
  return {
    status: row.status || 'open',
    source: row.source || 'manual',
    submitted_at: row.submitted_at,
    rejected_at: row.rejected_at,
    passed_at: row.passed_at,
    contacts: (contacts || []).map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.role, ...asObject(c.extra) })),
    events: events || [],
    prep_notes: row.prep_notes || '',
    jd: row.jd || null,
    posting: row.posting || null,
    essays: (essays || []).map((essay) => ({
      id: essay.field_id || '',
      label: essay.label || '',
      normalized_key: essay.normalized_key || '',
      llm_draft: essay.llm_draft || '',
      final: essay.final || '',
      source_card_ids: asArray(essay.source_card_ids),
    })),
    updated_at: row.updated_at || null,
  };
}

function readEssays(applicationId) {
  return store
    .query(
      'SELECT field_id, label, normalized_key, llm_draft, final, source_card_ids FROM essays WHERE application_id = ? ORDER BY created_at',
      [applicationId]
    )
    .map((row) => ({
      id: row.field_id || '',
      label: row.label || '',
      normalized_key: row.normalized_key || '',
      llm_draft: row.llm_draft || '',
      final: row.final || '',
      source_card_ids: asArray(row.source_card_ids),
    }));
}

function briefRecord(row, events) {
  if (!row) return emptyProcess();
  return {
    status: row.status || 'open',
    source: row.source || 'manual',
    submitted_at: row.submitted_at || null,
    rejected_at: row.rejected_at || null,
    passed_at: row.passed_at || null,
    contacts: [],
    events: (events || []).map((event) => ({
      at: event.at,
      type: event.type || '',
      deleted: Boolean(event.deleted),
    })),
    prep_notes: '',
    jd: null,
    posting: row.posting || null,
    essays: [],
    updated_at: row.updated_at || null,
  };
}

function processFromApp(row) {
  if (!row) return emptyProcess();
  const events = store.query(
    'SELECT at, type, title, body, contact_id, deleted FROM application_events WHERE application_id = ? ORDER BY at',
    [row.id]
  );
  const contacts = store
    .query('SELECT id, name, email, role, extra FROM application_contacts WHERE application_id = ?', [row.id])
    .map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.role, ...asObject(c.extra) }));
  return {
    status: row.status || 'open',
    source: row.source || 'manual',
    submitted_at: row.submitted_at,
    rejected_at: row.rejected_at,
    passed_at: row.passed_at,
    contacts,
    events,
    prep_notes: row.prep_notes || '',
    jd: row.jd || null,
    posting: row.posting || null,
    essays: readEssays(row.id),
    updated_at: row.updated_at || null,
  };
}

function insertEvent(applicationId, event) {
  store.exec(
    `INSERT INTO application_events (application_id, at, type, title, body, contact_id, deleted)
     VALUES (?,?,?,?,?,?,?)`,
    [
      applicationId,
      event.at || new Date().toISOString(),
      event.type || 'note',
      event.title || '',
      event.body || '',
      event.contact_id || null,
      Boolean(event.deleted),
    ]
  );
}

function insertContact(applicationId, contact) {
  const id = String(contact.id || `c-${Date.now()}`);
  const extra = { ...contact };
  delete extra.id;
  delete extra.name;
  delete extra.email;
  delete extra.role;
  store.exec(
    `INSERT INTO application_contacts (id, application_id, name, email, role, extra) VALUES (?,?,?,?,?,?)`,
    [id, applicationId, contact.name || '', contact.email || '', contact.role || '', extra]
  );
  return id;
}

function stampProcess(next) {
  const now = new Date().toISOString();
  if (next.status === 'submitted' && !next.submitted_at) next.submitted_at = now;
  if (next.status === 'passed' && !next.passed_at) next.passed_at = now;
  if (next.status === 'rejected' && !next.rejected_at) next.rejected_at = now;
  return now;
}

function updateApplication(row, next, now) {
  store.exec(
    `UPDATE applications SET status=?, source=?, submitted_at=?, rejected_at=?, passed_at=?, prep_notes=?, jd=?, posting=?, updated_at=?
     WHERE id=?`,
    [
      statusOf(next.status),
      next.source || row.source || 'manual',
      next.submitted_at || null,
      next.rejected_at || null,
      next.passed_at || null,
      next.prep_notes || '',
      jsonParam(next.jd),
      jsonParam(next.posting),
      now,
      row.id,
    ]
  );
}

function replaceChildren(applicationId, rec) {
  store.exec('DELETE FROM application_events WHERE application_id = ?', [applicationId]);
  for (const event of rec.events || []) insertEvent(applicationId, event);
  store.exec('DELETE FROM application_contacts WHERE application_id = ?', [applicationId]);
  for (const contact of rec.contacts || []) insertContact(applicationId, contact);
  store.exec('DELETE FROM essays WHERE application_id = ?', [applicationId]);
  for (const essay of rec.essays || []) {
    store.exec(
      `INSERT INTO essays (application_id, field_id, label, normalized_key, llm_draft, final, source_card_ids, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        applicationId,
        essay.id || essay.field_id || '',
        essay.label || '',
        essay.normalized_key || '',
        essay.llm_draft || '',
        essay.final || '',
        asArray(essay.source_card_ids),
        new Date().toISOString(),
      ]
    );
  }
}

function settingsFromRow(row) {
  if (!row) return settingsMod.normalize({});
  return settingsMod.normalize({
    chatSound: row.chat_sound,
    contextCtrlTab: row.context_ctrl_tab,
    autofillQueueN: row.autofill_queue_n,
    handedness: row.handedness,
    uiLanguage: row.ui_language,
    modelId: row.model_id,
    modelParams: asObject(row.model_params),
    customModels: asArray(row.custom_models),
    sidebarWidth: row.sidebar_width,
    drawerWidth: row.drawer_width,
    sidebarFilters: asObject(row.sidebar_filters),
  });
}

function writeSettings(doc) {
  const next = settingsMod.normalize(doc);
  store.exec(
    `UPDATE settings SET chat_sound=?, context_ctrl_tab=?, autofill_queue_n=?, handedness=?, ui_language=?,
       model_id=?, model_params=?, custom_models=?, sidebar_width=?, drawer_width=?, sidebar_filters=?, updated_at=?
     WHERE id = true`,
    [
      next.chatSound,
      next.contextCtrlTab,
      next.autofillQueueN,
      next.handedness,
      next.uiLanguage,
      next.modelId,
      next.modelParams,
      JSON.stringify(next.customModels || []),
      next.sidebarWidth,
      next.drawerWidth,
      next.sidebarFilters,
      new Date().toISOString(),
    ]
  );
  return next;
}

const docMem = new Map();

function documentBody(kind, fallback) {
  if (docMem.has(kind)) return docMem.get(kind);
  const row = store.queryOne('SELECT body FROM documents WHERE kind = ?', [kind]);
  const text = row && String(row.body || '').trim() ? row.body : fallback == null ? '' : fallback;
  docMem.set(kind, text);
  return text;
}

async function documentBodyAsync(kind, fallback) {
  if (docMem.has(kind)) return docMem.get(kind);
  const row = await store.queryOneAsync('SELECT body FROM documents WHERE kind = ?', [kind]);
  const text = row && String(row.body || '').trim() ? row.body : fallback == null ? '' : fallback;
  docMem.set(kind, text);
  return text;
}

function setDocument(kind, body) {
  const text = String(body ?? '');
  store.exec(
    `INSERT INTO documents (kind, body, updated_at) VALUES (?,?,?)
     ON CONFLICT (kind) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    [kind, text, new Date().toISOString()]
  );
  docMem.set(kind, text);
  return text;
}

function profileFromParts(row, educationRows, employmentRows, skillRows, answerRows) {
  if (!row) return {};
  const education = (educationRows || []).map((item) => ({
    school: item.school,
    degree: item.degree || '',
    start: item.start || '',
    end: item.end_date || '',
    current: Boolean(item.current),
    gpa: item.gpa,
    gpa_scale: item.gpa_scale,
    honors: Boolean(item.honors),
  }));
  const employment = (employmentRows || []).map((item) => ({
    employer: item.employer,
    title: item.title || '',
    start: item.start || '',
    end: item.end_date || '',
    current: Boolean(item.current),
    location: item.location || '',
    bullets: item.bullets || '',
  }));
  const skills = {};
  if (row.skills_as_of) skills.as_of = String(row.skills_as_of).slice(0, 10);
  for (const skill of skillRows || []) {
    skills[skill.slug] = {
      years: Number(skill.years) || 0,
      since: skill.since,
      aliases: asArray(skill.aliases),
    };
  }
  const answers = {};
  for (const answer of answerRows || []) {
    const extra = asObject(answer.extra);
    answers[answer.slug || answer.class] = {
      ...extra,
      class: answer.class,
      slug: answer.slug,
      value: answer.value,
      confidence: answer.confidence,
      source: answer.source || '',
      label: answer.label || '',
      confirmed_at: answer.confirmed_at,
    };
  }
  return {
    identity: asObject(row.identity),
    eeo: asObject(row.eeo),
    work: asObject(row.work),
    policy: asObject(row.policy),
    education,
    employment,
    skills,
    answers,
  };
}

let profileMem;
let profileFlight = null;

function profileDoc() {
  if (profileMem !== undefined) return profileMem;
  const row = store.queryOne('SELECT * FROM applicant WHERE id = true');
  if (!row) {
    profileMem = {};
    return profileMem;
  }
  profileMem = profileFromParts(
    row,
    store.query('SELECT * FROM applicant_education ORDER BY sort_index, school'),
    store.query('SELECT * FROM applicant_employment ORDER BY sort_index, employer'),
    store.query('SELECT * FROM applicant_skills ORDER BY slug'),
    store.query('SELECT * FROM applicant_answers')
  );
  return profileMem;
}

function profileDocAsync() {
  if (profileMem !== undefined) return Promise.resolve(profileMem);
  if (profileFlight) return profileFlight;
  profileFlight = (async () => {
    const row = await store.queryOneAsync('SELECT * FROM applicant WHERE id = true');
    if (!row) {
      profileMem = {};
      return profileMem;
    }
    const [education, employment, skills, answers] = await Promise.all([
      store.queryAsync('SELECT * FROM applicant_education ORDER BY sort_index, school'),
      store.queryAsync('SELECT * FROM applicant_employment ORDER BY sort_index, employer'),
      store.queryAsync('SELECT * FROM applicant_skills ORDER BY slug'),
      store.queryAsync('SELECT * FROM applicant_answers'),
    ]);
    profileMem = profileFromParts(row, education, employment, skills, answers);
    return profileMem;
  })().finally(() => {
    profileFlight = null;
  });
  return profileFlight;
}

function saveProfile(doc) {
  const next = doc && typeof doc === 'object' ? doc : {};
  const skills = next.skills && typeof next.skills === 'object' ? next.skills : {};
  store.transaction(() => {
    store.exec(
      `INSERT INTO applicant (id, identity, eeo, work, policy, skills_as_of, updated_at)
       VALUES (true, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET identity=excluded.identity, eeo=excluded.eeo, work=excluded.work,
         policy=excluded.policy, skills_as_of=excluded.skills_as_of, updated_at=excluded.updated_at`,
      [next.identity || {}, next.eeo || {}, next.work || {}, next.policy || {}, asDate(skills.as_of), new Date().toISOString()]
    );
    store.exec('DELETE FROM applicant_education');
    (next.education || []).forEach((item, index) => {
      if (!item || !item.school) return;
      store.exec(
        `INSERT INTO applicant_education (sort_index, school, degree, start, end_date, current, gpa, gpa_scale, honors)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          index,
          item.school,
          item.degree || '',
          item.start || null,
          item.end || item.end_date || null,
          Boolean(item.current),
          item.gpa == null || item.gpa === '' ? null : item.gpa,
          item.gpa_scale == null || item.gpa_scale === '' ? null : item.gpa_scale,
          Boolean(item.honors),
        ]
      );
    });
    store.exec('DELETE FROM applicant_employment');
    (next.employment || []).forEach((item, index) => {
      if (!item || !item.employer) return;
      store.exec(
        `INSERT INTO applicant_employment (sort_index, employer, title, start, end_date, current, location, bullets)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          index,
          item.employer,
          item.title || '',
          item.start || null,
          item.end || item.end_date || null,
          Boolean(item.current),
          item.location || '',
          item.bullets || '',
        ]
      );
    });
    store.exec('DELETE FROM applicant_skills');
    for (const [slug, skill] of Object.entries(skills)) {
      if (slug === 'as_of' || !skill || typeof skill !== 'object') continue;
      store.exec('INSERT INTO applicant_skills (slug, years, since, aliases) VALUES (?,?,?,?)', [
        slug,
        Number(skill.years) || 0,
        skill.since == null ? null : skill.since,
        asArray(skill.aliases),
      ]);
    }
    store.exec('DELETE FROM applicant_answers');
    const answers = next.answers && typeof next.answers === 'object' ? next.answers : {};
    for (const [key, answer] of Object.entries(answers)) {
      if (!answer || typeof answer !== 'object') continue;
      const extra = { ...answer };
      for (const name of ['class', 'slug', 'value', 'confidence', 'source', 'label', 'confirmed_at']) delete extra[name];
      store.exec(
        `INSERT INTO applicant_answers (class, slug, value, confidence, source, label, confirmed_at, extra)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          answer.class || key,
          answer.slug || key,
          answer.value == null ? '' : String(answer.value),
          answer.confidence || 'confirmed',
          answer.source || '',
          answer.label || '',
          answer.confirmed_at || null,
          extra,
        ]
      );
    }
  });
  profileMem = next;
  return next;
}

function recipeFromRow(row) {
  const extra = asObject(row.extra);
  return {
    ...extra,
    id: row.id,
    host_includes: asArray(row.host_includes),
    label_includes: asArray(row.label_includes),
    label_key: row.label_key || '',
    profile_key: row.profile_key || '',
    value: row.value,
    shape: row.shape || null,
    steps: asArray(row.steps).length ? asArray(row.steps) : row.steps || [],
    option_hash: row.option_hash || '',
    learned_at: row.learned_at,
  };
}

function chatState(row) {
  if (!row) {
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
  return {
    messages: asArray(row.messages),
    folded: asArray(row.folded),
    agentId: row.agent_id || '',
    snapshotKey: row.snapshot_key || '',
    company: row.company || '',
    title: row.title || '',
    pageSubtab: chatTabs.asPageSubtab(row.page_subtab),
  };
}

function materializeResume(row, download) {
  const base = {
    id: row.id,
    label: row.label,
    filename: row.filename,
    mime: row.mime || 'application/pdf',
    match: asArray(row.match_patterns),
    isDefault: Boolean(row.is_default),
    storagePath: row.storage_path || '',
    importedAt: row.imported_at,
    abs: '',
  };
  if (!download || !row.storage_path || !storage.ready()) return base;
  const name = path.basename(row.storage_path);
  const dest = storage.cachePath('resumes', name);
  const stamp = storage.cachePath('resumes', `${name}.imported`);
  const want = String(row.imported_at || '');
  let have = '';
  try {
    if (fs.existsSync(stamp)) have = fs.readFileSync(stamp, 'utf8');
  } catch (_) {}
  if (!fs.existsSync(dest) || have !== want) {
    storage.download('resumes', name, dest);
    try {
      fs.writeFileSync(stamp, want);
    } catch (_) {}
  }
  base.abs = dest;
  return base;
}

const resumeCache = { list: null, files: new Map() };
const boardCache = { rows: null };
let jobsMem = null;
let jobsFlight = null;
let settingsMem;
let recipesMem = null;
let aliasesMem = null;
const processMem = new Map();

function rememberProcess(url, rec) {
  const raw = String(url || '');
  const canon = canonicalUrl(raw);
  if (raw) processMem.set(raw, rec);
  if (canon) processMem.set(canon, rec);
  return rec;
}

function cachedProcess(url) {
  const raw = String(url || '');
  const canon = canonicalUrl(raw);
  if (canon && processMem.has(canon)) return processMem.get(canon);
  if (raw && processMem.has(raw)) return processMem.get(raw);
  return null;
}

function patchJobsMem(url, status, updatedAt) {
  if (!jobsMem || !url) return;
  const canon = canonicalUrl(url);
  for (const job of jobsMem) {
    if (job.url === url || (canon && job.canonical_url === canon)) {
      job.status = status || job.status || 'open';
      job.bucket = filterBucket(job.status);
      if (updatedAt) job.updatedAt = updatedAt;
    }
  }
}

function joinJobList(jobRows, apps) {
  const jobs = (jobRows || []).map(jobFromRow);
  const byCanon = new Map();
  const byUrl = new Map();
  for (const row of apps || []) {
    if (row.canonical_url) byCanon.set(row.canonical_url, row);
    if (row.url) byUrl.set(row.url, row);
  }
  return jobs.map((job) => {
    const app = byCanon.get(job.canonical_url || canonicalUrl(job.url)) || byUrl.get(job.url) || null;
    const rec = briefRecord(app, []);
    return {
      ...job,
      status: rec.status || 'open',
      bucket: filterBucket(rec.status),
      updatedAt: sidebarFilters.updatedAt(job, rec),
    };
  });
}

const JOBS_SQL = `SELECT id, url, canonical_url, company, title, linkedin, posting, logo, hostname, salary, yoe, level, location, industries, skills, notes, sort_index, updated_at
  FROM jobs ORDER BY sort_index, created_at`;
const APPS_SQL = `SELECT id, url, canonical_url, status, source, submitted_at, rejected_at, passed_at, updated_at
  FROM applications`;

function interviewEventsSql() {
  // Same set as lib/mail/cache.js INTERVIEW_TYPES. Mail uses these rows to keep an interview thread.
  return `SELECT application_id, at, type, deleted FROM application_events
    WHERE type IN ('recruiter_screen', 'hiring_manager', 'panel', 'onsite') AND deleted = false
    ORDER BY at`;
}

function groupEvents(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const id = String(row.application_id);
    const list = grouped.get(id);
    if (list) list.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

function loadJobList() {
  const jobs = store.query(JOBS_SQL);
  const apps = store.query(APPS_SQL);
  jobsMem = joinJobList(jobs, apps);
  return jobsMem;
}

function loadJobListAsync() {
  if (jobsMem) return Promise.resolve(jobsMem);
  if (jobsFlight) return jobsFlight;
  jobsFlight = (async () => {
    const [jobs, apps] = await Promise.all([store.queryAsync(JOBS_SQL), store.queryAsync(APPS_SQL)]);
    jobsMem = joinJobList(jobs, apps);
    return jobsMem;
  })().finally(() => {
    jobsFlight = null;
  });
  return jobsFlight;
}

function dropResumeCache() {
  resumeCache.list = null;
  resumeCache.files.clear();
}

function createNodeStore() {
  return {
    listJobs() {
      if (jobsMem) return jobsMem;
      return loadJobList();
    },
    listJobsAsync() {
      return loadJobListAsync();
    },
    processBriefs(urls) {
      const list = [...new Set((urls || []).map((url) => String(url || '')).filter(Boolean))];
      const out = new Map();
      if (!list.length) return out;
      const apps = store.query(APPS_SQL);
      const byCanon = new Map();
      const byUrl = new Map();
      for (const row of apps) {
        if (row.canonical_url) byCanon.set(row.canonical_url, row);
        if (row.url) byUrl.set(row.url, row);
      }
      const events = groupEvents(store.query(interviewEventsSql()));
      for (const url of list) {
        const canon = canonicalUrl(url);
        const app = (canon && byCanon.get(canon)) || byUrl.get(url) || null;
        out.set(url, briefRecord(app, app ? events.get(String(app.id)) : []));
      }
      return out;
    },
    getStatus(url) {
      const canon = canonicalUrl(url);
      const row = store.queryOne('SELECT status FROM applications WHERE canonical_url = ? OR url = ?', [canon, url]);
      return (row && row.status) || 'open';
    },
    hasJobUrl(...vals) {
      const urls = urlKeys(...vals);
      if (!urls.length) return false;
      const canons = [...new Set(urls.map((url) => canonicalUrl(url)).filter(Boolean))];
      const ph = urls.map(() => '?').join(',');
      const ch = canons.map(() => '?').join(',');
      return Boolean(
        store.queryOne(
          `SELECT 1 AS ok FROM jobs WHERE url IN (${ph}) OR linkedin IN (${ph}) OR posting IN (${ph}) OR canonical_url IN (${ch}) LIMIT 1`,
          [...urls, ...urls, ...urls, ...canons]
        )
      );
    },
    upsertJob(job) {
      jobsMem = null;
      const url = String((job && job.url) || '').trim();
      const canon = canonicalUrl(url);
      if (!canon) throw new Error('job url required');
      // shapeJob defaults a missing id to tab-0. Matching that id updates whichever
      // listing already owns tab-0, so a new URL has to be looked up by canonical only.
      const explicitId = job && job.id ? String(job.id) : '';
      const existing = explicitId
        ? store.queryOne('SELECT * FROM jobs WHERE id = ? OR canonical_url = ? LIMIT 1', [explicitId, canon])
        : store.queryOne('SELECT * FROM jobs WHERE canonical_url = ? LIMIT 1', [canon]);
      const id = (existing && existing.id) || explicitId || nextJobId();
      const shaped = shapeJob({ ...job, id }, 0);
      const now = new Date().toISOString();
      const values = {
        url: shaped.url,
        canonical_url: canon,
        company: shaped.company,
        title: shaped.title,
        linkedin: shaped.linkedin,
        posting: shaped.posting,
        logo: shaped.logo,
        hostname: shaped.hostname || hostnameOf(shaped.url),
        salary: shaped.salary,
        yoe: shaped.yoe,
        level: shaped.level,
        location: (job && job.location) || (existing && existing.location) || '',
        industries: shaped.industries,
        skills: shaped.skills,
        notes: shaped.notes || (job && job.notes) || '',
        updated_at: now,
      };
      if (existing) {
        store.exec(
          `UPDATE jobs SET url=?, canonical_url=?, company=?, title=?, linkedin=?, posting=?, logo=?, hostname=?,
             salary=?, yoe=?, level=?, location=?, industries=?, skills=?, notes=?, updated_at=? WHERE id=?`,
          [
            values.url,
            values.canonical_url,
            values.company,
            values.title,
            values.linkedin,
            values.posting,
            values.logo,
            values.hostname,
            values.salary,
            values.yoe,
            values.level,
            values.location,
            values.industries,
            values.skills,
            values.notes,
            now,
            existing.id,
          ]
        );
        return jobFromRow(store.queryOne('SELECT * FROM jobs WHERE id = ?', [existing.id]));
      }
      const sort = Number(store.queryOne('SELECT COALESCE(MAX(sort_index), -1) AS n FROM jobs').n) + 1;
      store.exec(
        `INSERT INTO jobs (id, url, canonical_url, company, title, linkedin, posting, logo, hostname, salary, yoe, level, location, industries, skills, notes, sort_index, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          values.url,
          canon,
          values.company,
          values.title,
          values.linkedin,
          values.posting,
          values.logo,
          values.hostname,
          values.salary,
          values.yoe,
          values.level,
          values.location,
          values.industries,
          values.skills,
          values.notes,
          sort,
          now,
        ]
      );
      return jobFromRow(store.queryOne('SELECT * FROM jobs WHERE id = ?', [id]));
    },
    removeJob(id) {
      jobsMem = null;
      store.exec('DELETE FROM jobs WHERE id = ?', [String(id)]);
      return { ok: true };
    },
    getJob(id) {
      return jobFromRow(store.queryOne('SELECT * FROM jobs WHERE id = ?', [String(id)]));
    },
    getProcess(url) {
      const hit = cachedProcess(url);
      if (hit) return hit;
      const canon = canonicalUrl(url);
      return rememberProcess(
        url,
        processFromApp(store.queryOne('SELECT * FROM applications WHERE canonical_url = ? OR url = ?', [canon, url]))
      );
    },
    async loadTabDetail(url) {
      const key = String(url || '');
      const canon = canonicalUrl(key);
      const [chatRow, app] = await Promise.all([
        store.queryOneAsync('SELECT * FROM chats WHERE key = ?', [key]),
        store.queryOneAsync('SELECT * FROM applications WHERE canonical_url = ? OR url = ?', [canon, key]),
      ]);
      if (!app) return { chat: chatState(chatRow), process: rememberProcess(key, emptyProcess()) };
      const [events, contacts, essays] = await Promise.all([
        store.queryAsync(
          'SELECT at, type, title, body, contact_id, deleted FROM application_events WHERE application_id = ? ORDER BY at',
          [app.id]
        ),
        store.queryAsync('SELECT id, name, email, role, extra FROM application_contacts WHERE application_id = ?', [app.id]),
        store.queryAsync(
          'SELECT field_id, label, normalized_key, llm_draft, final, source_card_ids FROM essays WHERE application_id = ? ORDER BY created_at',
          [app.id]
        ),
      ]);
      return { chat: chatState(chatRow), process: rememberProcess(key, processFromParts(app, events, contacts, essays)) };
    },
    hasProcess(url) {
      const canon = canonicalUrl(url);
      return Boolean(store.queryOne('SELECT id FROM applications WHERE canonical_url = ? OR url = ?', [canon, url]));
    },
    writeProcess(url, patch, opts = {}) {
      const prev = opts.base || this.getProcess(url);
      const next = { ...prev, ...patch };
      const now = stampProcess(next);
      const row = ensureApplication(url, next);
      updateApplication(row, next, now);
      replaceChildren(row.id, next);
      const saved = { ...next, status: statusOf(next.status), updated_at: now };
      rememberProcess(url, saved);
      patchJobsMem(url, saved.status, now);
      return saved;
    },
    appendProcessEvent(url, event) {
      const prev = this.getProcess(url);
      const next = applyProcessEvent(prev, event);
      const now = stampProcess(next);
      const row = ensureApplication(url, next);
      store.exec(
        `UPDATE applications SET status=?, source=?, submitted_at=?, rejected_at=?, passed_at=?, updated_at=? WHERE id=?`,
        [
          statusOf(next.status),
          next.source || row.source || 'manual',
          next.submitted_at || null,
          next.rejected_at || null,
          next.passed_at || null,
          now,
          row.id,
        ]
      );
      insertEvent(row.id, next.events[next.events.length - 1]);
      const saved = { ...next, status: statusOf(next.status), updated_at: now };
      rememberProcess(url, saved);
      patchJobsMem(url, saved.status, now);
      return saved;
    },
    addProcessContact(url, contact) {
      const prev = this.getProcess(url);
      const added = { id: contact.id || `c-${Date.now()}`, ...contact };
      const next = { ...prev, contacts: [...(prev.contacts || []), added] };
      const row = ensureApplication(url, next);
      const now = new Date().toISOString();
      store.exec('UPDATE applications SET updated_at=? WHERE id=?', [now, row.id]);
      const id = insertContact(row.id, added);
      const saved = { ...next, contacts: next.contacts.map((item) => (item === added ? { ...item, id } : item)), updated_at: now };
      rememberProcess(url, saved);
      patchJobsMem(url, saved.status, now);
      return saved;
    },
    getTotals() {
      const row = store.queryOne('SELECT submitted, passed, rejected FROM application_totals');
      return {
        submitted: Number(row && row.submitted) || 0,
        passed: Number(row && row.passed) || 0,
        rejected: Number(row && row.rejected) || 0,
      };
    },
    bumpTotal() {
      return this.getTotals();
    },
    getSettings() {
      if (settingsMem !== undefined) return settingsMem;
      settingsMem = settingsFromRow(store.queryOne('SELECT * FROM settings WHERE id = true'));
      return settingsMem;
    },
    async getSettingsAsync() {
      if (settingsMem !== undefined) return settingsMem;
      settingsMem = settingsFromRow(await store.queryOneAsync('SELECT * FROM settings WHERE id = true'));
      return settingsMem;
    },
    saveSettings(patch) {
      const next = writeSettings({ ...this.getSettings(), ...(patch || {}) });
      settingsMem = next;
      return next;
    },
    listResumes() {
      if (resumeCache.list) return resumeCache.list;
      resumeCache.list = store
        .query(
          'SELECT id, label, filename, mime, match_patterns, is_default, storage_path, imported_at FROM resumes ORDER BY is_default DESC, id'
        )
        .map((row) => materializeResume(row, false));
      return resumeCache.list;
    },
    async listResumesAsync() {
      if (resumeCache.list) return resumeCache.list;
      const rows = await store.queryAsync(
        'SELECT id, label, filename, mime, match_patterns, is_default, storage_path, imported_at FROM resumes ORDER BY is_default DESC, id'
      );
      resumeCache.list = rows.map((row) => materializeResume(row, false));
      return resumeCache.list;
    },
    importResume(row) {
      dropResumeCache();
      const id = String(row.id || `resume-${Date.now()}`);
      const filename = path.basename(row.filename || `${id}.pdf`);
      let storagePath = row.storagePath || '';
      const bytes = row.bytes
        ? Buffer.isBuffer(row.bytes)
          ? row.bytes
          : Buffer.from(String(row.bytes), 'base64')
        : null;
      const source = row.abs && fs.existsSync(row.abs) ? row.abs : '';
      let tmp = '';
      if ((bytes || source) && storage.ready()) {
        tmp = source || path.join(require('os').tmpdir(), `${id}.pdf`);
        if (!source && bytes) fs.writeFileSync(tmp, bytes);
        storagePath = storage.upload('resumes', `${id}.pdf`, tmp);
      }
      store.exec(
        `INSERT INTO resumes (id, label, filename, mime, match_patterns, is_default, storage_path, imported_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT (id) DO UPDATE SET label=excluded.label, filename=excluded.filename, mime=excluded.mime,
           match_patterns=excluded.match_patterns, is_default=excluded.is_default, storage_path=excluded.storage_path,
           imported_at=excluded.imported_at`,
        [
          id,
          row.label || filename,
          filename,
          row.mime || 'application/pdf',
          row.match || [],
          Boolean(row.isDefault || id === 'default'),
          storagePath,
          row.importedAt || new Date().toISOString(),
        ]
      );
      dropResumeCache();
      const saved = store.queryOne('SELECT * FROM resumes WHERE id = ?', [id]);
      const resume = saved ? materializeResume(saved, false) : null;
      if (resume && (source || (bytes && tmp))) resume.abs = source || tmp;
      return resume;
    },
    getResume(id) {
      const key = String(id);
      if (resumeCache.files.has(key)) return resumeCache.files.get(key);
      const row = store.queryOne('SELECT * FROM resumes WHERE id = ?', [key]);
      const resume = row ? materializeResume(row, true) : null;
      resumeCache.files.set(key, resume);
      return resume;
    },
    pickResume(job, overrideId) {
      const list = this.listResumes();
      let hit = null;
      if (overrideId) hit = list.find((item) => item.id === String(overrideId)) || null;
      if (!hit) {
        const hay = [job && job.title, job && job.level, job && job.name, job && job.company].filter(Boolean).join(' ');
        hit = list.find((row) => (row.match || []).some((pattern) => new RegExp(pattern, 'i').test(hay))) || null;
      }
      if (!hit) hit = list.find((item) => item.isDefault || item.id === 'default') || list[0] || null;
      return hit ? this.getResume(hit.id) : null;
    },
    getVoice() {
      return documentBody('voice', '');
    },
    getVoiceAsync() {
      return documentBodyAsync('voice', '');
    },
    setVoice(text) {
      return setDocument('voice', text);
    },
    getSystemPrompt() {
      return documentBody('system_prompt', '');
    },
    getSystemPromptAsync() {
      return documentBodyAsync('system_prompt', '');
    },
    setSystemPrompt(text) {
      return setDocument('system_prompt', text);
    },
    getReviewPrompt() {
      return documentBody('review_prompt', '');
    },
    setReviewPrompt(text) {
      return setDocument('review_prompt', text);
    },
    getChat(key) {
      return this.getChatState(key).messages;
    },
    getChatState(key) {
      const row = store.queryOne('SELECT * FROM chats WHERE key = ?', [String(key)]);
      return { url: String(key), ...chatState(row) };
    },
    async getChatStateAsync(key) {
      const row = await store.queryOneAsync('SELECT * FROM chats WHERE key = ?', [String(key)]);
      return { url: String(key), ...chatState(row) };
    },
    listChats() {
      return store.query('SELECT * FROM chats').map((row) => {
        const payload = chatState(row);
        return { key: row.key, url: row.key, ...payload };
      });
    },
    listApplicationJds() {
      return store.query('SELECT url, canonical_url, jd FROM applications');
    },
    getChatUi() {
      const row = store.queryOne('SELECT payload FROM chat_ui WHERE id = true');
      return chatTabs.normalizeUi(asObject(row && row.payload));
    },
    async getChatUiAsync() {
      const row = await store.queryOneAsync('SELECT payload FROM chat_ui WHERE id = true');
      return chatTabs.normalizeUi(asObject(row && row.payload));
    },
    saveChatUi(ui) {
      const next = chatTabs.normalizeUi(ui);
      store.exec('UPDATE chat_ui SET payload = ?, updated_at = ? WHERE id = true', [next, new Date().toISOString()]);
      return next;
    },
    saveChatUiAsync(ui) {
      const next = chatTabs.normalizeUi(ui);
      return store
        .execAsync('UPDATE chat_ui SET payload = ?, updated_at = ? WHERE id = true', [next, new Date().toISOString()])
        .then(() => next);
    },
    saveChat(key, messages, meta = {}) {
      const prev = this.getChatState(key);
      const fromObject = messages && !Array.isArray(messages) && typeof messages === 'object';
      const payload = fromObject
        ? { ...prev, ...chatState({ ...messages, agent_id: messages.agentId, snapshot_key: messages.snapshotKey, page_subtab: messages.pageSubtab }) }
        : {
            messages: Array.isArray(messages) ? messages : [],
            folded: meta.folded !== undefined ? meta.folded : prev.folded,
            agentId: meta.agentId !== undefined ? String(meta.agentId) : prev.agentId,
            snapshotKey: meta.snapshotKey !== undefined ? String(meta.snapshotKey) : prev.snapshotKey,
            company: meta.company !== undefined ? String(meta.company) : prev.company,
            title: meta.title !== undefined ? String(meta.title) : prev.title,
            pageSubtab: meta.pageSubtab !== undefined ? chatTabs.asPageSubtab(meta.pageSubtab) : prev.pageSubtab,
          };
      store.exec(
        `INSERT INTO chats (key, company, title, page_subtab, agent_id, snapshot_key, messages, folded, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT (key) DO UPDATE SET company=excluded.company, title=excluded.title, page_subtab=excluded.page_subtab,
           agent_id=excluded.agent_id, snapshot_key=excluded.snapshot_key, messages=excluded.messages, folded=excluded.folded,
           updated_at=excluded.updated_at`,
        [
          String(key),
          payload.company || '',
          payload.title || '',
          payload.pageSubtab || 'chat',
          payload.agentId || '',
          payload.snapshotKey || '',
          JSON.stringify(payload.messages || []),
          JSON.stringify(payload.folded || []),
          new Date().toISOString(),
        ]
      );
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
      if (recipesMem) return recipesMem;
      recipesMem = store.query('SELECT * FROM field_recipes').map(recipeFromRow);
      return recipesMem;
    },
    async listRecipesAsync() {
      if (recipesMem) return recipesMem;
      const rows = await store.queryAsync('SELECT * FROM field_recipes');
      recipesMem = rows.map(recipeFromRow);
      return recipesMem;
    },
    saveRecipe(recipe) {
      recipesMem = null;
      const id = String((recipe && recipe.id) || `recipe-${Date.now()}`);
      const known = new Set([
        'id',
        'host_includes',
        'label_includes',
        'label_key',
        'profile_key',
        'value',
        'shape',
        'steps',
        'option_hash',
        'optionHash',
        'learned_at',
      ]);
      const extra = {};
      for (const [key, value] of Object.entries(recipe || {})) {
        if (!known.has(key)) extra[key] = value;
      }
      store.exec(
        `INSERT INTO field_recipes (id, host_includes, label_includes, label_key, profile_key, value, shape, steps, option_hash, learned_at, extra)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (id) DO UPDATE SET host_includes=excluded.host_includes, label_includes=excluded.label_includes,
           label_key=excluded.label_key, profile_key=excluded.profile_key, value=excluded.value, shape=excluded.shape,
           steps=excluded.steps, option_hash=excluded.option_hash, learned_at=excluded.learned_at, extra=excluded.extra`,
        [
          id,
          asArray(recipe.host_includes),
          asArray(recipe.label_includes),
          recipe.label_key || '',
          recipe.profile_key || '',
          recipe.value == null ? null : String(recipe.value),
          recipe.shape || null,
          JSON.stringify(recipe.steps || []),
          recipe.option_hash || recipe.optionHash || '',
          recipe.learned_at || null,
          extra,
        ]
      );
      return recipeFromRow(store.queryOne('SELECT * FROM field_recipes WHERE id = ?', [id]));
    },
    replaceRecipes(recipes) {
      recipesMem = null;
      store.transaction(() => {
        store.exec('DELETE FROM field_recipes');
        for (const recipe of recipes || []) this.saveRecipe(recipe);
      });
      return this.listRecipes();
    },
    getProfile: profileDoc,
    getProfileAsync: profileDocAsync,
    setProfile(doc) {
      return saveProfile(doc);
    },
    getMailQueue() {
      return store.query('SELECT payload FROM mail_queue ORDER BY created_at').map((row) => asObject(row.payload));
    },
    addMailItem(item) {
      const row = { id: item.id || `mail-${Date.now()}`, ...item };
      store.exec(
        `INSERT INTO mail_queue (id, payload, created_at) VALUES (?,?,?)
         ON CONFLICT (id) DO UPDATE SET payload = excluded.payload`,
        [row.id, row, new Date().toISOString()]
      );
      return row;
    },
    listMailMessages() {
      return store.query('SELECT * FROM mail_messages ORDER BY created_at').map((row) => ({
        id: row.id,
        hash: row.hash,
        thread_id: row.thread_id || '',
        from: row.from_addr || '',
        subject: row.subject || '',
        date: row.date || '',
        verdict: row.verdict || '',
        matched_url: row.matched_url || null,
        keep_body: Boolean(row.keep_body),
      }));
    },
    replaceMailMessages(index) {
      const seen = new Set();
      const rows = [];
      for (const [id, row] of Object.entries(index || {})) {
        if (!id) continue;
        let hash = (row && row.hash) || id;
        if (seen.has(hash)) hash = `${hash}:${id}`;
        seen.add(hash);
        let date = (row && row.date) || null;
        if (date && Number.isNaN(Date.parse(date))) date = null;
        else if (date) date = new Date(date).toISOString();
        rows.push({ id, hash, row, date });
      }
      store.transaction(() => {
        store.exec('DELETE FROM mail_messages');
        for (const item of rows) {
          const row = item.row;
          store.exec(
            `INSERT INTO mail_messages (id, hash, thread_id, from_addr, subject, date, verdict, matched_url, keep_body)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT (id) DO UPDATE SET hash=excluded.hash, thread_id=excluded.thread_id, from_addr=excluded.from_addr,
               subject=excluded.subject, date=excluded.date, verdict=excluded.verdict, matched_url=excluded.matched_url,
               keep_body=excluded.keep_body`,
            [
              item.id,
              item.hash,
              (row && row.thread_id) || null,
              (row && (row.from || row.from_addr)) || null,
              (row && row.subject) || null,
              item.date,
              (row && row.verdict) || null,
              (row && row.matched_url) || null,
              Boolean(row && row.keep_body),
            ]
          );
        }
      });
      return this.listMailMessages();
    },
    replaceMailQueue(queue) {
      store.transaction(() => {
        store.exec('DELETE FROM mail_queue');
        (queue || []).forEach((item, index) => {
          const id = (item && item.id) || `mail-${index}`;
          this.addMailItem({ ...(item || {}), id });
        });
      });
      return this.getMailQueue();
    },
    removeMailItem(id) {
      store.exec('DELETE FROM mail_queue WHERE id = ?', [String(id)]);
      return this.getMailQueue();
    },
    getHuntSession() {
      const row = store.queryOne('SELECT payload FROM hunt_sessions WHERE id = true');
      return row ? row.payload : null;
    },
    saveHuntSession(value) {
      store.exec('UPDATE hunt_sessions SET payload = ?, updated_at = ? WHERE id = true', [
        value == null ? null : value,
        new Date().toISOString(),
      ]);
      return value;
    },
    getMailStatus() {
      const row = store.queryOne('SELECT * FROM mail_sync WHERE id = true') || {};
      return {
        connected: Boolean(row.connected),
        email: row.email || '',
        scanned_at: row.scanned_at || null,
        indexed: Number(row.indexed) || 0,
        pending: Number(row.pending) || 0,
        history_id: row.history_id || '',
        historyId: row.history_id || '',
      };
    },
    setMailStatus(patch) {
      const next = { ...this.getMailStatus(), ...(patch || {}) };
      let historyId = next.history_id || null;
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'historyId')) historyId = patch.historyId || null;
      else if (patch && Object.prototype.hasOwnProperty.call(patch, 'history_id')) historyId = patch.history_id || null;
      store.exec(
        `UPDATE mail_sync SET history_id=?, scanned_at=?, connected=?, email=?, indexed=?, pending=? WHERE id = true`,
        [historyId, next.scanned_at || null, Boolean(next.connected), next.email || '', next.indexed || 0, next.pending || 0]
      );
      return this.getMailStatus();
    },
    listBoards() {
      if (boardCache.rows) return boardCache.rows;
      boardCache.rows = store.query('SELECT company, ats, slug, source_url FROM boards ORDER BY company').map((row) => ({
        company: row.company,
        ats: row.ats,
        slug: row.slug,
        source_url: row.source_url || '',
      }));
      return boardCache.rows;
    },
    upsertBoard(partial, company) {
      const { upsertBoardList, shapeBoard } = require('../../core/src/boards');
      const row = shapeBoard(partial, company);
      if (!row) return null;
      const next = upsertBoardList(this.listBoards(), partial, company);
      store.exec(
        `INSERT INTO boards (company, ats, slug, source_url) VALUES (?,?,?,?)
         ON CONFLICT (ats, slug) DO UPDATE SET company = excluded.company, source_url = excluded.source_url`,
        [row.company || company || row.slug, row.ats, row.slug, row.source_url || partial.source_url || '']
      );
      boardCache.rows = next.map((item) => ({
        company: item.company,
        ats: item.ats,
        slug: item.slug,
        source_url: item.source_url || '',
      }));
      return row;
    },
    deleteBoard(ats, slug) {
      store.exec('DELETE FROM boards WHERE ats = ? AND slug = ?', [ats, slug]);
      if (boardCache.rows) {
        boardCache.rows = boardCache.rows.filter((row) => !(row.ats === ats && row.slug === slug));
      }
      return this.listBoards();
    },
    listTagRules() {
      const doc = { industries: {}, skills: {}, exclude: {} };
      for (const row of store.query('SELECT kind, slug, keywords FROM tag_rules')) {
        const key = row.kind === 'industry' ? 'industries' : row.kind === 'skill' ? 'skills' : row.kind;
        const bucket = doc[key] || (doc[key] = {});
        bucket[row.slug] = asArray(row.keywords);
      }
      return doc;
    },
    replaceTagRules(doc) {
      store.transaction(() => {
        store.exec('DELETE FROM tag_rules');
        for (const kind of ['industry', 'skill', 'exclude', 'industries', 'skills']) {
          const mapped = kind === 'industries' ? 'industry' : kind === 'skills' ? 'skill' : kind;
          const bucket = doc && doc[kind];
          if (!bucket || typeof bucket !== 'object') continue;
          for (const [slug, keywords] of Object.entries(bucket)) {
            store.exec(
              `INSERT INTO tag_rules (kind, slug, keywords) VALUES (?,?,?)
               ON CONFLICT (kind, slug) DO UPDATE SET keywords = excluded.keywords`,
              [mapped, slug, asArray(keywords)]
            );
          }
        }
      });
      return this.listTagRules();
    },
    listAliases() {
      if (aliasesMem) return aliasesMem;
      aliasesMem = store.query('SELECT class, phrase FROM question_aliases ORDER BY class, phrase');
      return aliasesMem;
    },
    async listAliasesAsync() {
      if (aliasesMem) return aliasesMem;
      aliasesMem = await store.queryAsync('SELECT class, phrase FROM question_aliases ORDER BY class, phrase');
      return aliasesMem;
    },
    addAlias(classId, phrase) {
      aliasesMem = null;
      store.exec(
        'INSERT INTO question_aliases (class, phrase) VALUES (?,?) ON CONFLICT (class, phrase) DO NOTHING',
        [classId, phrase]
      );
      return { class: classId, phrase };
    },
    replaceAliases(rows) {
      const have = this.listAliases();
      aliasesMem = null;
      store.transaction(() => {
        for (const row of have || []) {
          store.exec('DELETE FROM question_aliases WHERE class = ? AND phrase = ?', [row.class, row.phrase]);
        }
        for (const row of rows || []) {
          if (!row || !row.class || !row.phrase) continue;
          store.exec(
            'INSERT INTO question_aliases (class, phrase) VALUES (?,?) ON CONFLICT (class, phrase) DO NOTHING',
            [String(row.class), String(row.phrase)]
          );
        }
      });
      return this.listAliases();
    },
    loadStrategy() {
      return strategyFromRows(
        store.query('SELECT * FROM strategy_scores'),
        store.query('SELECT * FROM strategy_fingerprints')
      );
    },
    async loadStrategyAsync() {
      const [scores, prints] = await Promise.all([
        store.queryAsync('SELECT * FROM strategy_scores'),
        store.queryAsync('SELECT * FROM strategy_fingerprints'),
      ]);
      return strategyFromRows(scores, prints);
    },
    saveStrategy(doc) {
      const { prints, scores } = strategyRows(doc);
      const rest = require('../../../lib/store/rest');
      rest.del('strategy_scores', 'fingerprint=not.is.null');
      rest.del('strategy_fingerprints', 'fingerprint=not.is.null');
      if (prints.length) rest.insert('strategy_fingerprints', prints);
      if (scores.length) rest.insert('strategy_scores', scores);
      return doc;
    },
    async saveStrategyAsync(doc) {
      const { prints, scores } = strategyRows(doc);
      const rest = require('../../../lib/store/rest');
      await rest.delAsync('strategy_scores', 'fingerprint=not.is.null');
      await rest.delAsync('strategy_fingerprints', 'fingerprint=not.is.null');
      if (prints.length) await rest.insertAsync('strategy_fingerprints', prints);
      if (scores.length) await rest.insertAsync('strategy_scores', scores);
      return doc;
    },
    warm() {
      return Promise.all(
        [
          this.getSettingsAsync(),
          this.getVoiceAsync(),
          this.getSystemPromptAsync(),
          this.getProfileAsync(),
          this.listRecipesAsync(),
          this.listAliasesAsync(),
        ].map((job) =>
          Promise.resolve(job).catch((err) => {
            console.warn('[magnet] warm:', (err && err.message) || err);
          })
        )
      );
    },
    listFootprints() {
      return store.query('SELECT * FROM footprints').map((row) => ({
        id: row.id,
        prompt: row.prompt,
        options: row.options_key,
        kind: row.kind,
        ...asObject(row.extra),
      }));
    },
    saveFootprints(doc) {
      store.transaction(() => {
        store.exec('DELETE FROM footprints');
        for (const row of (doc && doc.footprints) || []) {
          if (!row || !row.id) continue;
          const extra = { ...row };
          delete extra.id;
          delete extra.prompt;
          delete extra.options;
          delete extra.kind;
          store.exec(
            `INSERT INTO footprints (id, prompt, options_key, kind, extra, updated_at) VALUES (?,?,?,?,?,?)`,
            [row.id, row.prompt || '', row.options || '', row.kind || '', extra, new Date().toISOString()]
          );
        }
      });
      return { version: 1, footprints: this.listFootprints() };
    },
    listExperienceNotes() {
      return store.query('SELECT employer, at, text FROM experience_notes ORDER BY at').map((row) => ({
        employer: row.employer,
        at: row.at,
        text: row.text,
      }));
    },
    saveExperienceNotes(notes) {
      store.transaction(() => {
        store.exec('DELETE FROM experience_notes');
        for (const note of notes || []) {
          if (!note || !note.text) continue;
          store.exec('INSERT INTO experience_notes (employer, at, text) VALUES (?,?,?)', [
            note.employer || '',
            note.at || new Date().toISOString(),
            note.text,
          ]);
        }
      });
      return this.listExperienceNotes();
    },
    recordIncident(note, kind) {
      const row = {
        id: String(note.id),
        kind: kind === 'blocker' ? 'blocker' : 'bug',
        format: kind === 'blocker' ? 'SITE-BLOCK' : 'JM-BUG',
        area: note.area || '',
        host: note.host || '',
        company: note.company || '',
        url: note.url || '',
        what: note.what || '',
        where_text: note.where || note.where_text || '',
        evidence: note.evidence || '',
      };
      store.exec(
        `INSERT INTO incidents (id, kind, format, area, host, company, url, what, where_text, evidence)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (id) DO UPDATE SET what=excluded.what, where_text=excluded.where_text, evidence=excluded.evidence`,
        [row.id, row.kind, row.format, row.area, row.host, row.company, row.url, row.what, row.where_text, row.evidence]
      );
      return { ...note, id: row.id, format: row.format };
    },
    insertLog(table, row) {
      const cols = Object.keys(row).filter((key) => row[key] !== undefined);
      const vals = cols.map((key) => row[key]);
      store.exec(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
      return row;
    },
    exportBundle() {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        jobs: this.listJobs(),
        totals: this.getTotals(),
        settings: this.getSettings(),
        profile: this.getProfile(),
        voice: this.getVoice(),
        systemPrompt: this.getSystemPrompt(),
      };
    },
    exportLiveYaml() {
      return { skipped: true };
    },
    importBundle() {
      throw new Error('importBundle is not used on the supabase store');
    },
  };
}

module.exports = { createNodeStore };
