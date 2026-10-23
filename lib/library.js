/** Read and edit the records Magnet stores: story cards, the autofill profile, and logs. */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const yaml = require('js-yaml');
const graph = require('./graph');
const facts = require('./profile-facts');
const { isSupabase } = require('./store/mode');

const CLIP = 40000;
const SECRET = /token|secret|password|refresh|authorization|api[_-]?key|service[_-]?role|credential/i;

const SECTIONS = [
  {
    id: 'cards',
    group: 'Autofill',
    label: 'Story cards',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Work stories essay drafts are retrieved from. The claim is the sentence Magnet is allowed to use.',
  },
  {
    id: 'profile',
    group: 'Autofill',
    label: 'Profile',
    mode: 'profile',
    edit: true,
    single: true,
    help: 'Facts autofill writes into forms: identity, work, EEO, education, employment, skills, and saved answers.',
  },
  {
    id: 'notes',
    group: 'Autofill',
    label: 'Experience notes',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Source notes compiled into story cards. Editing a note does not rewrite cards that were already filed.',
  },
  {
    id: 'voice',
    group: 'Writing',
    label: 'Essay voice',
    mode: 'text',
    edit: true,
    single: true,
    help: 'The essay prompt Magnet writes in. Saving keeps a version, same as the sidebar voice editor.',
  },
  {
    id: 'system',
    group: 'Writing',
    label: 'System prompt',
    mode: 'text',
    edit: true,
    single: true,
    help: 'Instructions for the co-editor in chat.',
  },
  {
    id: 'review',
    group: 'Writing',
    label: 'Review prompt',
    mode: 'text',
    edit: true,
    single: true,
    help: 'Instructions for the leftover-field review.',
  },
  {
    id: 'answers',
    group: 'Logs',
    label: 'Answer log',
    mode: 'log',
    help: 'Shipped form answers, keyed by the listing URL. Read-only, so a view here cannot rewrite a submission.',
  },
  {
    id: 'essays',
    group: 'Logs',
    label: 'Essay log',
    mode: 'log',
    help: 'Long-form drafts and the finals that shipped with them. Read-only.',
  },
  {
    id: 'actions',
    group: 'Logs',
    label: 'Action log',
    mode: 'log',
    help: 'What Magnet did on each request: fills, voice saves, harvests. Read-only.',
  },
  {
    id: 'events',
    group: 'Logs',
    label: 'Graph events',
    mode: 'log',
    help: 'Append-only events on the story graph. Read-only.',
  },
  {
    id: 'llm',
    group: 'Logs',
    label: 'LLM log',
    mode: 'log',
    help: 'Model calls, with the prompt and output Magnet stored. Read-only.',
  },
  {
    id: 'attempts',
    group: 'Logs',
    label: 'Autofill attempts',
    mode: 'log',
    help: 'One row per autofill pass. Read-only.',
  },
  {
    id: 'timing',
    group: 'Logs',
    label: 'Timing',
    mode: 'log',
    help: 'How long fills and drafts took. Read-only.',
  },
  {
    id: 'sessions',
    group: 'Logs',
    label: 'Essay sessions',
    mode: 'log',
    help: 'Saved essay-session files from the archive. Read-only.',
  },
  {
    id: 'timeline',
    group: 'Graph',
    label: 'Employers',
    mode: 'record',
    edit: true,
    create: true,
    remove: false,
    help: 'Employer rows story cards hang off. Removing one would delete its cards, so this list only edits.',
  },
  {
    id: 'bindings',
    group: 'Graph',
    label: 'Question bindings',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Which card or tag a question shape should retrieve.',
  },
  {
    id: 'moments',
    group: 'Graph',
    label: 'Moments',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Short remembered moments on the graph.',
  },
  {
    id: 'positions',
    group: 'Graph',
    label: 'Positions',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Position statements on the graph.',
  },
  {
    id: 'stubs',
    group: 'Graph',
    label: 'Resume stubs',
    mode: 'log',
    help: 'Unverified lines pulled off a resume. Read-only.',
  },
  {
    id: 'recipes',
    group: 'Learned',
    label: 'Field recipes',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Learned widget steps autofill replays: label, host, and the click or type sequence.',
  },
  {
    id: 'aliases',
    group: 'Learned',
    label: 'Question aliases',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Phrases mapped onto a question class so autofill can recognize the field.',
  },
  {
    id: 'footprints',
    group: 'Learned',
    label: 'Footprints',
    mode: 'log',
    help: 'Stored prompt footprints. Read-only.',
  },
  {
    id: 'jobs',
    group: 'Apply',
    label: 'Jobs',
    mode: 'log',
    help: 'The job list. Read-only here; the sidebar is where a listing is opened.',
  },
  {
    id: 'process',
    group: 'Apply',
    label: 'Applications',
    mode: 'log',
    help: 'Status, essays, and notes stored for each listing. Read-only.',
  },
  {
    id: 'boards',
    group: 'Apply',
    label: 'Boards',
    mode: 'record',
    edit: true,
    create: true,
    help: 'Company boards Magnet hunts. Company, ATS, and slug.',
  },
  {
    id: 'submissions',
    group: 'Apply',
    label: 'AI submissions',
    mode: 'log',
    help: 'Listings marked as agent submissions. Read-only.',
  },
  {
    id: 'mail',
    group: 'Apply',
    label: 'Mail index',
    mode: 'log',
    help: 'Scanned mail Magnet matched to applications. Tokens are hidden. Read-only.',
  },
  {
    id: 'resumes',
    group: 'Apply',
    label: 'Resumes',
    mode: 'log',
    help: 'Resume files on file, without the PDF bytes. Read-only.',
  },
  {
    id: 'settings',
    group: 'App',
    label: 'Settings',
    mode: 'record',
    edit: true,
    single: true,
    help: 'The same settings as the sidebar dialog.',
  },
  {
    id: 'tags',
    group: 'App',
    label: 'Tag rules',
    mode: 'yaml',
    edit: true,
    single: true,
    help: 'Industry and skill keywords used when a listing is tagged.',
  },
  {
    id: 'playbook',
    group: 'App',
    label: 'Playbook',
    mode: 'yaml',
    edit: true,
    single: true,
    help: 'Playbook notes stored next to the other knowledge files.',
  },
  {
    id: 'strategy',
    group: 'App',
    label: 'Strategy cache',
    mode: 'log',
    help: 'Which fill strategy won for each widget. Magnet writes this from attempts. Read-only.',
  },
  {
    id: 'state',
    group: 'App',
    label: 'Apply totals',
    mode: 'record',
    single: true,
    help: 'Submitted, passed, and rejected counts. Read-only.',
  },
  {
    id: 'chats',
    group: 'App',
    label: 'Chats',
    mode: 'log',
    help: 'Sidebar conversations. Read-only.',
  },
];

const memo = new Map();

function knowledgeDir() {
  return process.env.MAGNET_KNOWLEDGE || path.join(__dirname, '..', 'knowledge');
}

function archiveDirs() {
  return [
    ...new Set(
      [process.env.MAGNET_ARCHIVE, path.join(knowledgeDir(), 'archive'), path.join(__dirname, '..', 'knowledge', 'archive')]
        .filter(Boolean)
        .map((dir) => path.resolve(dir))
    ),
  ];
}

function jobsPath() {
  return process.env.MAGNET_JOBS || path.join(knowledgeDir(), 'jobs.yaml');
}

function db() {
  graph.ensureOpen();
  const api = require('./store/api');
  return api.getDriver() ? api : require('./store');
}

function sectionDef(id) {
  return SECTIONS.find((section) => section.id === id) || null;
}

function remember(key, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 1000) return hit.value;
  const value = fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

function clearMemo() {
  memo.clear();
}

function readYaml(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    return doc == null ? fallback : doc;
  } catch {
    return fallback;
  }
}

function writeYaml(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = typeof doc === 'string' ? doc : yaml.dump(doc, { lineWidth: 100, noRefs: true, sortingKeys: false });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

function sqlCount(sql) {
  try {
    const row = db().queryOne(sql);
    if (!row) return 0;
    return Number(row.n ?? row.N ?? Object.values(row)[0]) || 0;
  } catch {
    return null;
  }
}

function optionalQuery(sql, params) {
  try {
    return db().query(sql, params) || [];
  } catch {
    return [];
  }
}

function parseMaybe(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function redact(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET.test(key) ? (val ? '••••' : '') : redact(val, depth + 1);
  }
  return out;
}

function clipText(value) {
  const text = String(value ?? '');
  if (text.length <= CLIP) return text;
  return `${text.slice(0, CLIP)}\n… (${text.length - CLIP} more characters)`;
}

function clipValue(value, depth = 0) {
  if (typeof value === 'string') return clipText(value);
  if (depth > 8 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const sliced = value.slice(0, 200).map((item) => clipValue(item, depth + 1));
    if (value.length > 200) sliced.push(`… ${value.length - 200} more`);
    return sliced;
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) out[key] = clipValue(val, depth + 1);
  return out;
}

function forClient(section, value) {
  const hidden = section.edit ? value : redact(value);
  return section.edit ? hidden : clipValue(hidden);
}

function lineCount(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return 0;
    return text.split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function readJsonl(file) {
  try {
    const buf = fs.readFileSync(file);
    const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function archiveFiles(names) {
  const found = [];
  for (const dir of archiveDirs()) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) found.push(full);
    }
  }
  return [...new Set(found)];
}

function remoteRows(table, query) {
  try {
    const rows = require('./store/remote-log').restSelect(table, query);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function logId(row, index) {
  return `${row && row.ts ? row.ts : 'row'}|${index}`;
}

function newest(rows) {
  return rows.slice().reverse();
}

function jsonlRows(names, remoteTable, remoteQuery, labelOf) {
  const local = [];
  for (const file of archiveFiles(names)) local.push(...readJsonl(file));
  const remote = remoteTable ? remoteRows(remoteTable, remoteQuery) : [];
  return newest([...local, ...remote]).map((row, index) => ({
    id: logId(row, index),
    title: labelOf(row),
    subtitle: row.company || row.url || row.kind || row.caller || row.model || '',
    record: row,
  }));
}

function persistApi() {
  const persist = require('../packages/persist');
  persist.open();
  return persist.nodeStore();
}

function cardRows() {
  const rows = db().query('SELECT id, employer, claim, confidence FROM cards ORDER BY employer, claim');
  return rows.map((row) => ({
    id: row.id,
    title: row.employer || 'No employer',
    subtitle: `${row.confidence || 'corroborated'} · ${row.claim || ''}`,
    record: null,
  }));
}

function cardDetail(id) {
  const row = db().queryOne('SELECT * FROM cards WHERE id = ?', [id]);
  if (!row) return null;
  const tags = db()
    .query('SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag', [id])
    .map((item) => item.tag);
  const people = db().query('SELECT name, relation FROM card_people WHERE card_id = ? ORDER BY name', [id]);
  const shapes = db()
    .query('SELECT shape FROM card_shapes WHERE card_id = ? ORDER BY shape', [id])
    .map((item) => item.shape);
  const links = db().query('SELECT to_id, kind FROM card_links WHERE from_id = ?', [id]);
  return {
    record: {
      employer: row.employer || '',
      claim: row.claim || '',
      proof: row.proof || '',
      honesty_bound: row.honesty_bound || '',
      confidence: row.confidence || 'corroborated',
      source: row.source || '',
      tags,
      people,
      shapes,
    },
    meta: { id: row.id, created_at: row.created_at || '', links },
  };
}

function normalizeTimeline(row) {
  return {
    employer: row.employer || '',
    title: row.title || '',
    start: row.start || '',
    end: row.end || row.end_date || '',
    location: row.location || '',
    current: Boolean(row.current),
  };
}

function indexed(rows, prefix, titleOf, subtitleOf) {
  return rows.map((row, index) => ({
    id: `${prefix}:${index}`,
    title: titleOf(row, index),
    subtitle: subtitleOf(row, index),
    record: row,
  }));
}

function stripMeta(record) {
  const next = {};
  for (const [key, value] of Object.entries(record && typeof record === 'object' ? record : {})) {
    if (key.startsWith('_')) continue;
    next[key] = value;
  }
  return next;
}

function indexOf(id, prefix) {
  const match = String(id || '').match(new RegExp(`^${prefix}:(\\d+)$`));
  return match ? Number(match[1]) : -1;
}

function loadList(section) {
  return remember(section.id, () => loaders[section.id]());
}

function profileBundle() {
  const doc = facts.load() || {};
  let raw = '';
  try {
    raw = facts.rawYaml() || '';
  } catch {
    raw = '';
  }
  if (!raw) {
    try {
      raw = yaml.dump(doc, { lineWidth: 100, noRefs: true, sortingKeys: false });
    } catch {
      raw = '';
    }
  }
  return { record: doc, yaml: raw };
}

function textBundle(text) {
  return { record: { text: String(text ?? '') } };
}

function jobRows() {
  if (isSupabase()) {
    try {
      return persistApi().listJobs() || [];
    } catch {
      return [];
    }
  }
  const file = jobsPath();
  if (!fs.existsSync(file)) return [];
  try {
    return require('./jobs-file').loadJobsFile(file);
  } catch {
    return [];
  }
}

function applicationRows() {
  const sql = isSupabase()
    ? 'SELECT url, status, submitted_at, rejected_at, updated_at FROM applications'
    : 'SELECT url, status, submitted_at, rejected_at, updated_at FROM process_records';
  try {
    const rows = db().query(sql);
    if (rows.length) return rows;
  } catch {
    /* yaml fallback below */
  }
  if (isSupabase()) return [];
  try {
    const doc = require('./process-store').loadProcess();
    return Object.entries((doc && doc.by_url) || {}).map(([url, rec]) => ({ url, ...(rec || {}) }));
  } catch {
    return [];
  }
}

function boardRows() {
  if (isSupabase()) {
    try {
      return persistApi().listBoards() || [];
    } catch {
      return [];
    }
  }
  const doc = readYaml(path.join(knowledgeDir(), 'boards.yaml'), { boards: [] });
  return Array.isArray(doc.boards) ? doc.boards : [];
}

function aliasRows() {
  if (isSupabase()) {
    try {
      return persistApi().listAliases() || [];
    } catch {
      return [];
    }
  }
  const file = process.env.MAGNET_ALIASES || path.join(knowledgeDir(), 'question-aliases.yaml');
  const doc = readYaml(file, { aliases: [] });
  return Array.isArray(doc.aliases) ? doc.aliases : [];
}

function insideArchive(file) {
  const resolved = path.resolve(String(file || ''));
  return archiveDirs().some((dir) => resolved === dir || resolved.startsWith(`${dir}${path.sep}`));
}

const loaders = {
  cards: cardRows,
  profile: profileBundle,
  notes() {
    const notes = require('./employment').loadExperienceNotes() || [];
    return indexed(
      notes,
      'note',
      (row) => row.employer || 'Note',
      (row) => row.text || ''
    );
  },
  voice() {
    graph.ensureOpen();
    const essay = require('./essay-prompt');
    graph.seedVoiceFromFile(essay.loadRichboi());
    const row = graph.currentVoice();
    return textBundle((row && row.text) || essay.loadRichboi());
  },
  system() {
    return textBundle(require('./essay-prompt').loadSystemPrompt());
  },
  review() {
    return textBundle(require('./review-prompt').loadReviewRules());
  },
  answers() {
    const rows = require('./answer-log').loadLoggedAnswers() || [];
    return newest(rows).map((row, index) => ({
      id: logId(row, index),
      title: row.label || row.normalized_key || 'Answer',
      subtitle: [row.company, row.kind, row.value].filter(Boolean).join(' · '),
      record: row,
    }));
  },
  essays() {
    const rows = require('./essay-log').loadLoggedEssays() || [];
    return newest(rows).map((row, index) => ({
      id: logId(row, index),
      title: row.label || 'Essay',
      subtitle: [row.company, row.origin, row.final || row.llm_draft].filter(Boolean).join(' · '),
      record: row,
    }));
  },
  actions() {
    let rows = [];
    try {
      rows = require('./action-log').listEntries();
    } catch {
      rows = [];
    }
    const remote = remoteRows('action_log', 'select=ts,request_id,kind,summary,extra&order=ts.desc&limit=500');
    const merged = newest([
      ...rows,
      ...remote.map((row) => (row.extra && typeof row.extra === 'object' ? { ...row.extra, ...row } : row)),
    ]);
    return merged.map((row, index) => ({
      id: logId(row, index),
      title: row.kind || 'action',
      subtitle: row.summary || row.request_id || '',
      record: row,
    }));
  },
  events() {
    const rows = optionalQuery('SELECT id, ts, kind, payload, request_id FROM events ORDER BY id DESC LIMIT 2000');
    return rows.map((row) => ({
      id: String(row.id),
      title: row.kind || 'event',
      subtitle: [row.ts, row.request_id].filter(Boolean).join(' · '),
      record: { ...row, payload: parseMaybe(row.payload) },
    }));
  },
  llm() {
    return jsonlRows(['llm.jsonl'], 'llm_log', 'select=ts,caller,model,request_id,input,output,error,duration_ms&order=ts.desc&limit=300', (row) =>
      [row.caller, row.model].filter(Boolean).join(' · ') || 'LLM call'
    );
  },
  attempts() {
    return jsonlRows(
      ['attempts.jsonl'],
      'autofill_attempts',
      'select=ts,url,company,field_count,essays,static_ok,static_total,label&order=ts.desc&limit=300',
      (row) => row.company || row.label || 'Autofill'
    );
  },
  timing() {
    return jsonlRows(
      ['timing.jsonl'],
      'timing_events',
      'select=ts,kind,tab_id,url,company,title&order=ts.desc&limit=300',
      (row) => row.kind || row.type || row.title || 'Timing'
    );
  },
  sessions() {
    const rows = [];
    for (const dir of archiveDirs()) {
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!/^essay-session-.+\.json$/.test(name)) continue;
        const full = path.join(dir, name);
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        rows.push({
          id: full,
          title: name,
          subtitle: st.mtime.toISOString(),
          record: null,
        });
      }
    }
    rows.sort((a, b) => String(b.subtitle).localeCompare(String(a.subtitle)));
    return rows;
  },
  timeline() {
    return db()
      .query('SELECT * FROM timeline')
      .map((row) => {
        const item = normalizeTimeline(row);
        return { id: row.id, title: item.employer || 'Employer', subtitle: [item.title, item.start, item.end].filter(Boolean).join(' · '), record: item };
      });
  },
  bindings() {
    return db()
      .query('SELECT * FROM bindings ORDER BY question_shape')
      .map((row) => ({
        id: row.id,
        title: row.question_shape || 'Binding',
        subtitle: row.card_id || row.tag || '',
        record: {
          question_shape: row.question_shape || '',
          card_id: row.card_id || '',
          tag: row.tag || '',
          source: row.source || '',
        },
      }));
  },
  moments() {
    return optionalQuery('SELECT * FROM moments ORDER BY created_at').map((row) => ({
      id: row.id,
      title: String(row.text || '').slice(0, 80) || 'Moment',
      subtitle: row.confidence || row.source || '',
      record: { text: row.text || '', tags: row.tags || '', confidence: row.confidence || '', source: row.source || '' },
    }));
  },
  positions() {
    return optionalQuery('SELECT * FROM positions ORDER BY created_at').map((row) => ({
      id: row.id,
      title: String(row.text || '').slice(0, 80) || 'Position',
      subtitle: row.source || '',
      record: { text: row.text || '', source: row.source || '' },
    }));
  },
  stubs() {
    return optionalQuery('SELECT * FROM stubs ORDER BY created_at').map((row) => ({
      id: row.id,
      title: String(row.text || '').slice(0, 80) || 'Stub',
      subtitle: row.confidence || '',
      record: row,
    }));
  },
  recipes() {
    const recipes = require('./field-recipes').listRecipes() || [];
    return indexed(
      recipes,
      'recipe',
      (row, index) => row.label_key || (Array.isArray(row.label_includes) ? row.label_includes.slice(0, 2).join(', ') : '') || `Recipe ${index + 1}`,
      (row) => row.profile_key || (Array.isArray(row.host_includes) ? row.host_includes.join(', ') : '')
    );
  },
  aliases() {
    return indexed(
      aliasRows(),
      'alias',
      (row) => row.class || 'Alias',
      (row) => row.phrase || ''
    );
  },
  footprints() {
    return optionalQuery('SELECT id, prompt, options_key, kind, updated_at FROM footprints').map((row) => ({
      id: row.id,
      title: row.kind || row.id,
      subtitle: row.prompt || '',
      record: row,
    }));
  },
  jobs() {
    return jobRows().map((job, index) => ({
      id: String(job.id || job.url || index),
      title: [job.company, job.title].filter(Boolean).join(' — ') || job.url || 'Job',
      subtitle: [job.level, job.yoe, job.url].filter(Boolean).join(' · '),
      record: job,
    }));
  },
  process() {
    return applicationRows().map((row, index) => ({
      id: String(row.url || index),
      title: row.url || 'Application',
      subtitle: [row.status, row.submitted_at].filter(Boolean).join(' · '),
      record: null,
    }));
  },
  boards() {
    return indexed(
      boardRows(),
      'board',
      (row) => row.company || row.slug || 'Board',
      (row) => [row.ats, row.slug].filter(Boolean).join(' · ')
    );
  },
  submissions() {
    let rows = [];
    if (isSupabase()) rows = jobRows().filter((job) => job && (job.agent || job.ai));
    else if (fs.existsSync(jobsPath())) {
      try {
        rows = require('./ai-submissions').loadSubmissions(jobsPath());
      } catch {
        rows = [];
      }
    }
    return rows.map((job, index) => ({
      id: String(job.id || job.url || index),
      title: [job.company, job.title].filter(Boolean).join(' — ') || 'Submission',
      subtitle: job.submitted_at || job.url || '',
      record: job,
    }));
  },
  mail() {
    let index = {};
    try {
      index = require('./mail/cache').loadIndex() || {};
    } catch {
      index = {};
    }
    return Object.entries(index).map(([id, msg]) => {
      const row = msg && typeof msg === 'object' ? msg : { text: msg };
      return {
        id,
        title: row.subject || row.snippet || id,
        subtitle: [row.from, row.date || row.internalDate, row.kind || row.label].filter(Boolean).join(' · '),
        record: { id, ...row },
      };
    });
  },
  resumes() {
    return optionalQuery('SELECT id, label, filename, mime, match_patterns, is_default, imported_at FROM resumes').map((row) => ({
      id: row.id,
      title: row.label || row.filename || 'Resume',
      subtitle: row.filename || '',
      record: row,
    }));
  },
  settings() {
    return { record: require('./settings').load() };
  },
  tags() {
    if (isSupabase()) {
      try {
        return textBundle(yaml.dump(persistApi().listTagRules() || {}, { lineWidth: 100, noRefs: true, sortingKeys: false }));
      } catch (err) {
        return { error: (err && err.message) || 'Tag rules failed' };
      }
    }
    const file = path.join(knowledgeDir(), 'tag-rules.yaml');
    try {
      return textBundle(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    } catch (err) {
      return { error: (err && err.message) || 'Tag rules failed' };
    }
  },
  playbook() {
    const file = path.join(knowledgeDir(), 'playbook.yaml');
    try {
      return textBundle(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    } catch (err) {
      return { error: (err && err.message) || 'Playbook failed' };
    }
  },
  strategy() {
    let doc = {};
    try {
      doc = require('./strategy').loadCache() || {};
    } catch {
      doc = {};
    }
    const fps = (doc && doc.fingerprints) || {};
    return Object.entries(fps).map(([id, row]) => ({
      id,
      title: id,
      subtitle: (row && row.last_success) || '',
      record: row,
    }));
  },
  state() {
    try {
      return { record: require('./application-state').loadState() };
    } catch (err) {
      return { error: (err && err.message) || 'Totals failed' };
    }
  },
  chats() {
    return optionalQuery('SELECT key, updated_at FROM chats').map((row) => ({
      id: String(row.key),
      title: row.key,
      subtitle: row.updated_at || '',
      record: null,
    }));
  },
};

function counts() {
  return {
    cards: () => sqlCount('SELECT COUNT(*) AS n FROM cards'),
    profile: () => 1,
    notes: () => {
      try {
        return (require('./employment').loadExperienceNotes() || []).length;
      } catch {
        return null;
      }
    },
    voice: () => 1,
    system: () => 1,
    review: () => 1,
    answers: () => (isSupabase() ? null : lineCount(require('./answer-log').fieldsPath())),
    essays: () => (isSupabase() ? null : lineCount(require('./essay-log').answersPath())),
    actions: () => {
      try {
        return require('./action-log').listEntries().length;
      } catch {
        return null;
      }
    },
    events: () => sqlCount('SELECT COUNT(*) AS n FROM events'),
    llm: () => (isSupabase() ? null : archiveFiles(['llm.jsonl']).reduce((sum, file) => sum + lineCount(file), 0)),
    attempts: () => archiveFiles(['attempts.jsonl']).reduce((sum, file) => sum + lineCount(file), 0),
    timing: () => archiveFiles(['timing.jsonl']).reduce((sum, file) => sum + lineCount(file), 0),
    sessions: () => loaders.sessions().length,
    timeline: () => sqlCount('SELECT COUNT(*) AS n FROM timeline'),
    bindings: () => sqlCount('SELECT COUNT(*) AS n FROM bindings'),
    moments: () => sqlCount('SELECT COUNT(*) AS n FROM moments'),
    positions: () => sqlCount('SELECT COUNT(*) AS n FROM positions'),
    stubs: () => sqlCount('SELECT COUNT(*) AS n FROM stubs'),
    recipes: () => {
      try {
        return (require('./field-recipes').listRecipes() || []).length;
      } catch {
        return null;
      }
    },
    aliases: () => aliasRows().length,
    footprints: () => sqlCount('SELECT COUNT(*) AS n FROM footprints'),
    jobs: () => (fs.existsSync(jobsPath()) || isSupabase() ? null : 0),
    process: () => sqlCount(isSupabase() ? 'SELECT COUNT(*) AS n FROM applications' : 'SELECT COUNT(*) AS n FROM process_records'),
    boards: () => boardRows().length,
    submissions: () => null,
    mail: () => null,
    resumes: () => sqlCount('SELECT COUNT(*) AS n FROM resumes'),
    settings: () => 1,
    tags: () => 1,
    playbook: () => 1,
    strategy: () => null,
    state: () => 1,
    chats: () => sqlCount('SELECT COUNT(*) AS n FROM chats'),
  };
}

function publicSection(section, count) {
  return {
    id: section.id,
    group: section.group,
    label: section.label,
    mode: section.mode,
    edit: Boolean(section.edit),
    create: Boolean(section.create),
    remove: section.remove !== false && Boolean(section.edit) && !section.single,
    single: Boolean(section.single),
    help: section.help,
    count,
  };
}

function catalog() {
  const countFns = counts();
  return {
    sections: SECTIONS.map((section) => {
      let count = null;
      try {
        count = countFns[section.id] ? countFns[section.id]() : null;
      } catch {
        count = null;
      }
      return publicSection(section, count);
    }),
  };
}

function publish(section, rows, query) {
  const q = String((query && query.q) || '')
    .trim()
    .toLowerCase();
  const filtered = q
    ? rows.filter((row) => `${row.title || ''}\n${row.subtitle || ''}`.toLowerCase().includes(q))
    : rows;
  const offset = Math.max(0, Number(query && query.offset) || 0);
  const limit = Math.min(400, Math.max(1, Number(query && query.limit) || 80));
  return {
    total: filtered.length,
    rows: filtered.slice(offset, offset + limit).map((row) => ({
      id: String(row.id),
      title: row.title || '(untitled)',
      subtitle: String(row.subtitle || '')
        .replace(/\s+/g, ' ')
        .slice(0, 180),
    })),
  };
}

function query(input) {
  const section = sectionDef(input && input.section);
  if (!section) return { error: 'Unknown section' };
  let loaded;
  try {
    loaded = loadList(section);
  } catch (err) {
    return { error: (err && err.message) || 'Could not read that section', section: section.id };
  }
  if (loaded && loaded.error) return { error: loaded.error, section: section.id };
  const base = publicSection(section, null);
  if (section.single) {
    return {
      ...base,
      total: 1,
      rows: [{ id: section.id, title: section.label, subtitle: '' }],
      record: forClient(section, loaded.record),
      yaml: loaded.yaml || '',
    };
  }
  const page = publish(section, Array.isArray(loaded) ? loaded : [], input || {});
  return { ...base, ...page, count: page.total };
}

function findRow(section, id) {
  const loaded = loadList(section);
  if (!Array.isArray(loaded)) return null;
  return loaded.find((row) => String(row.id) === String(id)) || null;
}

function read(input) {
  const section = sectionDef(input && input.section);
  if (!section) return { error: 'Unknown section' };
  const id = input && input.id != null ? String(input.id) : '';
  if (section.single) return query({ section: section.id });
  if (section.id === 'cards') {
    const detail = cardDetail(id);
    if (!detail) return { error: 'That card is gone. Refresh.', section: section.id };
    return { ...publicSection(section, null), id, record: detail.record, meta: detail.meta };
  }
  if (section.id === 'process') {
    let record = null;
    try {
      record = require('./process-store').getRecord(id);
    } catch (err) {
      return { error: (err && err.message) || 'Could not read that application', section: section.id };
    }
    return { ...publicSection(section, null), id, record: forClient(section, { url: id, ...record }) };
  }
  if (section.id === 'sessions') {
    if (!insideArchive(id)) return { error: 'That session file is outside the archive.', section: section.id };
    try {
      const parsed = JSON.parse(fs.readFileSync(id, 'utf8'));
      return { ...publicSection(section, null), id, record: forClient(section, parsed) };
    } catch (err) {
      return { error: (err && err.message) || 'Could not read that session', section: section.id };
    }
  }
  if (section.id === 'chats') {
    const row = (() => {
      try {
        return db().queryOne('SELECT * FROM chats WHERE key = ?', [id]);
      } catch (err) {
        return { error: err };
      }
    })();
    if (row && row.error) return { error: row.error.message || 'Could not read that chat', section: section.id };
    if (!row) return { error: 'That chat is gone. Refresh.', section: section.id };
    let messages = parseMaybe(row.messages);
    if (!Array.isArray(messages) && row.messages && typeof row.messages === 'object') messages = row.messages;
    return {
      ...publicSection(section, null),
      id,
      record: forClient(section, {
        key: row.key,
        updated_at: row.updated_at || '',
        company: row.company || '',
        title: row.title || '',
        messages,
      }),
    };
  }
  const row = findRow(section, id);
  if (!row) return { error: 'That row is gone. Refresh.', section: section.id };
  if (row.record == null && section.id !== 'sessions') {
    return { error: 'Nothing stored on that row.', section: section.id };
  }
  return { ...publicSection(section, null), id, record: forClient(section, row.record) };
}

function fail(error) {
  return { ok: false, error };
}

function saveIndexed(prefix, rows, action, id, record, normalize) {
  const next = rows.map((row) => ({ ...row }));
  const index = indexOf(id, prefix);
  if (action === 'delete') {
    if (index < 0 || index >= next.length) return fail('That row is gone. Refresh.');
    next.splice(index, 1);
    return { ok: true, rows: next };
  }
  let clean;
  try {
    clean = normalize(stripMeta(record));
  } catch (err) {
    return fail((err && err.message) || 'Could not save that row');
  }
  if (clean && clean.error) return fail(clean.error);
  if (action === 'create' || index < 0 || index >= next.length) {
    next.push(clean);
    return { ok: true, rows: next, id: `${prefix}:${next.length - 1}` };
  }
  next[index] = clean;
  return { ok: true, rows: next, id: `${prefix}:${index}` };
}

function plainRows(loaded) {
  return (Array.isArray(loaded) ? loaded : []).map((row) => row.record).filter((row) => row != null);
}

function noteClean(record) {
  const text = String(record.text || '').trim();
  if (!text) return { error: 'A note needs text.' };
  return {
    employer: String(record.employer || '').trim(),
    at: record.at || new Date().toISOString(),
    text,
  };
}

function aliasClean(record) {
  const klass = String(record.class || '').trim();
  const phrase = String(record.phrase || '').trim();
  if (!klass || !phrase) return { error: 'An alias needs a class and a phrase.' };
  return { class: klass, phrase };
}

function boardClean(record) {
  const company = String(record.company || '').trim();
  const slug = String(record.slug || '').trim();
  if (!company && !slug) return { error: 'A board needs a company or a slug.' };
  return {
    ...record,
    company,
    ats: String(record.ats || '').trim(),
    slug,
    source_url: String(record.source_url || '').trim(),
  };
}

function recipeClean(record) {
  const label = String(record.label_key || '').trim();
  const includes = Array.isArray(record.label_includes) ? record.label_includes.filter(Boolean) : [];
  const profileKey = String(record.profile_key || '').trim();
  if (!label && !includes.length && !profileKey && !String(record.value || '').trim()) {
    return { error: 'A recipe needs a label, a profile key, or a value.' };
  }
  return record;
}

function writeAliases(rows) {
  if (isSupabase()) {
    persistApi().replaceAliases(rows);
  } else {
    const file = process.env.MAGNET_ALIASES || path.join(knowledgeDir(), 'question-aliases.yaml');
    writeYaml(file, { version: 1, aliases: rows });
  }
  try {
    require('./question-catalog').invalidate();
  } catch {
    /* catalog may be mid-load */
  }
}

function writeBoards(rows, previous, action, clean) {
  if (isSupabase()) {
    const api = persistApi();
    if (action === 'delete') {
      if (previous) api.deleteBoard(previous.ats, previous.slug);
      return;
    }
    if (previous && (previous.ats !== clean.ats || previous.slug !== clean.slug)) api.deleteBoard(previous.ats, previous.slug);
    api.upsertBoard(clean, clean.company);
    return;
  }
  const file = path.join(knowledgeDir(), 'boards.yaml');
  const doc = readYaml(file, { version: 1, boards: [] });
  doc.version = doc.version || 1;
  doc.boards = rows;
  writeYaml(file, doc);
}

function write(payload) {
  const section = sectionDef(payload && payload.section);
  if (!section) return fail('Unknown section');
  if (!section.edit) return fail('That record is read-only.');
  const action = payload.action || 'save';
  const id = payload.id != null ? String(payload.id) : '';
  clearMemo();
  try {
    if (section.id === 'cards') {
      if (action === 'delete') {
        graph.deleteCard(id);
        return { ok: true, id };
      }
      const saved = graph.replaceCard({ ...stripMeta(payload.record), id: action === 'create' ? '' : id });
      if (!saved.ok) return saved;
      const detail = cardDetail(saved.id);
      return { ok: true, id: saved.id, record: detail && detail.record, meta: detail && detail.meta };
    }
    if (section.id === 'profile') {
      if (action === 'yaml') {
        const text = payload.record && payload.record.text != null ? payload.record.text : payload.record;
        const doc = facts.writeRaw(text);
        return { ok: true, record: doc, yaml: facts.rawYaml() };
      }
      const doc = facts.replaceDocument(payload.record);
      return { ok: true, record: doc, yaml: facts.rawYaml() };
    }
    if (section.id === 'notes') {
      const current = plainRows(loaders.notes());
      const saved = saveIndexed('note', current, action, id, payload.record, noteClean);
      if (!saved.ok) return saved;
      require('./employment').saveExperienceNotes(saved.rows);
      clearMemo();
      return { ok: true, id: saved.id };
    }
    if (section.id === 'voice') {
      const text = payload.record && payload.record.text != null ? payload.record.text : '';
      const row = require('./voice-compact').saveUserVoice(text);
      return { ok: true, record: { text: (row && row.text) || text } };
    }
    if (section.id === 'system') {
      const text = payload.record && payload.record.text != null ? payload.record.text : '';
      return { ok: true, record: { text: require('./essay-prompt').saveSystemPrompt(text) } };
    }
    if (section.id === 'review') {
      const text = payload.record && payload.record.text != null ? payload.record.text : '';
      return { ok: true, record: { text: require('./review-prompt').saveReviewRules(text) } };
    }
    if (section.id === 'timeline') {
      const clean = stripMeta(payload.record);
      const employer = String(clean.employer || '').trim();
      if (!employer) return fail('An employer needs a name.');
      if (action === 'create' || !id) {
        const created = graph.upsertTimeline({
          employer,
          title: clean.title || '',
          start: clean.start || '',
          end: clean.end || '',
          location: clean.location || '',
          current: Boolean(clean.current),
        });
        return { ok: true, id: created };
      }
      db().exec('UPDATE timeline SET employer = ?, title = ?, start = ?, end = ?, location = ?, current = ? WHERE id = ?', [
        employer,
        clean.title || '',
        clean.start || '',
        clean.end || '',
        clean.location || '',
        clean.current ? 1 : 0,
        id,
      ]);
      return { ok: true, id };
    }
    if (section.id === 'bindings') {
      const clean = stripMeta(payload.record);
      if (action === 'delete') {
        if (!id) return fail('Missing binding.');
        db().exec('DELETE FROM bindings WHERE id = ?', [id]);
        return { ok: true, id };
      }
      const shape = String(clean.question_shape || '').trim().toLowerCase();
      if (!shape || (!clean.card_id && !clean.tag)) return fail('A binding needs a question and a card or a tag.');
      if (action === 'create' || !id) {
        const created = graph.addBinding({ ...clean, question_shape: shape });
        if (!created.binding) return fail('That binding is already on file.');
        return { ok: true, id: created.binding.id };
      }
      db().exec('UPDATE bindings SET question_shape = ?, card_id = ?, tag = ?, source = ? WHERE id = ?', [
        shape,
        clean.card_id || null,
        clean.tag || null,
        clean.source || 'library',
        id,
      ]);
      return { ok: true, id };
    }
    if (section.id === 'moments' || section.id === 'positions') {
      const table = section.id;
      const clean = stripMeta(payload.record);
      const text = String(clean.text || '').trim();
      if (action === 'delete') {
        if (!id) return fail('Missing row.');
        db().exec(`DELETE FROM ${table} WHERE id = ?`, [id]);
        return { ok: true, id };
      }
      if (!text) return fail('That row needs text.');
      if (action === 'create' || !id) {
        const created = graph.id(table === 'moments' ? 'moment' : 'pos', text);
        if (table === 'moments') {
          db().exec('INSERT INTO moments (id, text, tags, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
            created,
            text,
            clean.tags || '',
            clean.source || 'library',
            clean.confidence || '',
            new Date().toISOString(),
          ]);
        } else {
          db().exec('INSERT INTO positions (id, text, source, created_at) VALUES (?, ?, ?, ?)', [
            created,
            text,
            clean.source || 'library',
            new Date().toISOString(),
          ]);
        }
        return { ok: true, id: created };
      }
      if (table === 'moments') {
        db().exec('UPDATE moments SET text = ?, tags = ?, confidence = ?, source = ? WHERE id = ?', [
          text,
          clean.tags || '',
          clean.confidence || '',
          clean.source || '',
          id,
        ]);
      } else {
        db().exec('UPDATE positions SET text = ?, source = ? WHERE id = ?', [text, clean.source || '', id]);
      }
      return { ok: true, id };
    }
    if (section.id === 'recipes') {
      const current = plainRows(loaders.recipes());
      const saved = saveIndexed('recipe', current, action, id, payload.record, recipeClean);
      if (!saved.ok) return saved;
      require('./field-recipes').saveRecipes({ version: 2, recipes: saved.rows });
      clearMemo();
      return { ok: true, id: saved.id };
    }
    if (section.id === 'aliases') {
      const current = plainRows(loaders.aliases());
      const saved = saveIndexed('alias', current, action, id, payload.record, aliasClean);
      if (!saved.ok) return saved;
      writeAliases(saved.rows);
      clearMemo();
      return { ok: true, id: saved.id };
    }
    if (section.id === 'boards') {
      const current = plainRows(loaders.boards());
      const index = indexOf(id, 'board');
      const previous = index >= 0 ? current[index] : null;
      const saved = saveIndexed('board', current, action, id, payload.record, boardClean);
      if (!saved.ok) return saved;
      const clean = action === 'delete' ? null : saved.rows[action === 'create' || index < 0 ? saved.rows.length - 1 : index];
      writeBoards(saved.rows, previous, action, clean);
      clearMemo();
      return { ok: true, id: saved.id };
    }
    if (section.id === 'settings') {
      const next = require('./settings').save(stripMeta(payload.record));
      return { ok: true, record: next };
    }
    if (section.id === 'tags') {
      const text = payload.record && payload.record.text != null ? String(payload.record.text) : '';
      let doc;
      try {
        doc = text.trim() ? yaml.load(text) : {};
      } catch (err) {
        return fail(`YAML: ${(err && err.message) || err}`);
      }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return fail('Tag rules YAML must be a mapping.');
      if (isSupabase()) persistApi().replaceTagRules(doc);
      else writeYaml(path.join(knowledgeDir(), 'tag-rules.yaml'), text);
      return { ok: true, record: { text } };
    }
    if (section.id === 'playbook') {
      const text = payload.record && payload.record.text != null ? String(payload.record.text) : '';
      if (text.trim()) {
        try {
          yaml.load(text);
        } catch (err) {
          return fail(`YAML: ${(err && err.message) || err}`);
        }
      }
      writeYaml(path.join(knowledgeDir(), 'playbook.yaml'), text);
      return { ok: true, record: { text } };
    }
  } catch (err) {
    return fail((err && err.message) || 'Save failed');
  }
  return fail('That section cannot be saved.');
}

module.exports = {
  SECTIONS,
  catalog,
  query,
  read,
  write,
  redact,
};
