const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { DEFAULT_JOBS_FILE, logoForCompany } = require('./jobs-file');
const { canonicalUrl, indexJobs, postingKey, sameUrl } = require('./job-identity');

const JOBS_FILE = DEFAULT_JOBS_FILE;
const LEDGER_GIT_PATH = 'projects/jobmagnet/knowledge/ai-submissions.yaml';
const BRANCH = 'ai-submissions';

function agentId(url) {
  return 'agent-' + crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 12);
}

function loadDoc(text) {
  const repaired = String(text || '')
    .replace(/"version: 1"/g, 'version 1')
    .replace(/"submissions: \[\]"/g, 'submissions []');
  try {
    const doc = yaml.load(repaired) || {};
    return doc && typeof doc === 'object' ? doc : {};
  } catch {
    return null;
  }
}

function normalizeRow(row) {
  return {
    url: String(row.url).trim(),
    company: row.company ? String(row.company) : '',
    title: row.title ? String(row.title) : '',
    linkedin: row.linkedin ? String(row.linkedin) : '',
    posting: row.posting ? String(row.posting) : row.linkedin ? String(row.linkedin) : '',
    salary: row.salary ? String(row.salary) : '',
    location: row.location ? String(row.location) : '',
    level: row.level ? String(row.level) : '',
    yoe: row.yoe ? String(row.yoe) : '',
    submitted_at: row.submitted_at ? String(row.submitted_at) : '',
    source: row.source ? String(row.source) : 'ai-daily',
  };
}

function parseRows(text) {
  const doc = loadDoc(text);
  if (!doc) return [];
  const rows = Array.isArray(doc.submissions) ? doc.submissions : Array.isArray(doc.jobs) ? doc.jobs : Array.isArray(doc) ? doc : [];
  return rows.filter((row) => row && row.url).map(normalizeRow);
}

function readJobsText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return 'jobs:\n';
  }
}

function readJobsDoc(file) {
  const doc = loadDoc(readJobsText(file)) || { jobs: [] };
  if (!Array.isArray(doc.jobs)) doc.jobs = [];
  return doc;
}

function compactJob(row) {
  const next = normalizeRow(row);
  const job = {
    id: row.id ? String(row.id) : agentId(next.url),
    company: next.company,
    title: next.title,
    url: next.url,
    agent: true,
  };
  for (const key of ['linkedin', 'posting', 'salary', 'location', 'level', 'yoe', 'submitted_at']) {
    if (next[key]) job[key] = next[key];
  }
  return job;
}

function dumpList(items) {
  return yaml
    .dump(items, { lineWidth: 100, noRefs: true, sortingKeys: false })
    .trimEnd()
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
}

function insertJobBlock(text, block) {
  let src = text.endsWith('\n') ? text : `${text}\n`;
  src = src.replace(/^jobs:\s*\[\s*\]\s*$/m, 'jobs:');
  const marker = src.search(/^(bugs|blockers):/m);
  if (marker < 0) return src + block;
  return src.slice(0, marker) + block + src.slice(marker);
}

function noteKey(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.id) return `id:${item.id}`;
  if (item.host) return `host:${item.host}:${String(item.what || '').slice(0, 80)}`;
  return '';
}

function appendRootList(text, key, items) {
  const fresh = (items || []).filter((item) => noteKey(item));
  if (!fresh.length) return text;
  const doc = loadDoc(text) || {};
  const have = new Set((Array.isArray(doc[key]) ? doc[key] : []).map(noteKey).filter(Boolean));
  const adding = fresh.filter((item) => !have.has(noteKey(item)));
  if (!adding.length) return text;
  const chunk = `${dumpList(adding)}\n`;
  const src = text.endsWith('\n') ? text : `${text}\n`;
  if (!Array.isArray(doc[key])) return `${src}${key}:\n${chunk}`;
  const header = src.match(new RegExp(`^${key}:\\n`, 'm'));
  if (!header) return `${src}${key}:\n${chunk}`;
  const start = header.index + header[0].length;
  const rest = src.slice(start);
  const next = rest.search(/^(?![ \n])\S/m);
  const at = next < 0 ? src.length : start + next;
  return src.slice(0, at) + chunk + src.slice(at);
}

function flagAgent(text, url, submittedAt) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => /^\s*url:/.test(line) && line.includes(url));
  if (at < 0) return text;
  const keyIndent = lines[at].match(/^\s*/)[0].length;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    if (indent < keyIndent) {
      end = i;
      break;
    }
    if (indent === keyIndent && lines[i].trim().startsWith('- ')) {
      end = i;
      break;
    }
  }
  const slice = lines.slice(at, end).join('\n');
  if (/\bagent:\s*true\b/.test(slice)) return text;
  const pad = ' '.repeat(keyIndent);
  const extra = [`${pad}agent: true`];
  if (submittedAt && !/^\s*submitted_at:/m.test(slice)) extra.push(`${pad}submitted_at: '${submittedAt}'`);
  lines.splice(end, 0, ...extra);
  return lines.join('\n');
}

function importAgentRows(rows, { jobsFile = JOBS_FILE, bugs, blockers } = {}) {
  let text = readJobsText(jobsFile);
  const doc = readJobsDoc(jobsFile);
  const index = indexJobs(doc.jobs);
  let added = 0;
  let marked = 0;
  for (const raw of rows || []) {
    if (!raw || !raw.url) continue;
    const row = normalizeRow(raw);
    const existing = sameUrl(row, index);
    if (existing) {
      if (!existing.agent) {
        text = flagAgent(text, existing.url, row.submitted_at);
        existing.agent = true;
        marked += 1;
      }
      continue;
    }
    const job = compactJob(row);
    text = insertJobBlock(text, `${dumpList([job])}\n`);
    doc.jobs.push(job);
    for (const key of [canonicalUrl(job.url), canonicalUrl(job.linkedin), canonicalUrl(job.posting)]) {
      if (key) index.byCanon.set(key, job);
    }
    const key = postingKey(job);
    if (key && !index.byPosting.has(key)) index.byPosting.set(key, job);
    added += 1;
  }
  text = appendRootList(text, 'bugs', bugs);
  text = appendRootList(text, 'blockers', blockers);
  fs.mkdirSync(path.dirname(jobsFile), { recursive: true });
  fs.writeFileSync(jobsFile, text.endsWith('\n') ? text : `${text}\n`);
  clearSubmissionCache();
  return { added, marked, jobs: doc.jobs.length };
}

let submissionCache = { file: '', at: 0, rows: null };

function clearSubmissionCache() {
  submissionCache = { file: '', at: 0, rows: null };
}

function loadSubmissions(file = JOBS_FILE) {
  const now = Date.now();
  if (submissionCache.rows && submissionCache.file === file && now - submissionCache.at < 5000) {
    return submissionCache.rows;
  }
  const rows = readJobsDoc(file)
    .jobs.filter((job) => job && job.url && job.agent)
    .map((job) => normalizeRow({ ...job, source: 'ai-daily' }));
  submissionCache = { file, at: now, rows };
  return rows;
}

function appendListedJobs(rows, file = JOBS_FILE) {
  let text = readJobsText(file);
  const doc = readJobsDoc(file);
  const index = indexJobs(doc.jobs);
  let added = 0;
  for (const raw of rows || []) {
    if (!raw || !raw.url) continue;
    const row = normalizeRow(raw);
    if (sameUrl(row, index)) continue;
    const post = postingKey(row);
    if (post && index.byPosting.has(post)) continue;
    const job = { company: row.company, title: row.title, url: row.url };
    for (const key of ['linkedin', 'posting', 'salary', 'location', 'level', 'yoe']) {
      if (row[key]) job[key] = row[key];
    }
    text = insertJobBlock(text, `${dumpList([job])}\n`);
    doc.jobs.push(job);
    for (const key of [canonicalUrl(job.url), canonicalUrl(job.linkedin), canonicalUrl(job.posting)]) {
      if (key) index.byCanon.set(key, job);
    }
    if (post && !index.byPosting.has(post)) index.byPosting.set(post, job);
    added += 1;
  }
  if (!added) return { added };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  clearSubmissionCache();
  return { added };
}

function recordSubmission(row, file = JOBS_FILE) {
  if (!row || !row.url) throw new Error('url required');
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    const api = persist.nodeStore();
    const submittedAt = row.submitted_at || new Date().toISOString();
    const job = api.upsertJob({
      id: agentId(row.url),
      url: row.url,
      company: row.company,
      title: row.title,
      linkedin: row.linkedin,
      posting: row.posting,
      salary: row.salary,
      location: row.location,
      level: row.level,
      yoe: row.yoe,
      notes: 'AI daily apply',
    });
    const prev = api.getProcess(row.url);
    const at = (prev && prev.submitted_at) || submittedAt;
    api.writeProcess(row.url, { status: 'submitted', source: 'agent', submitted_at: at });
    api.appendProcessEvent(row.url, { type: 'submitted', title: 'Applied', at });
    return { ...job, submitted_at: at, agent: true, source: 'ai-daily' };
  }
  const existing = sameUrl(normalizeRow(row), indexJobs(readJobsDoc(file).jobs));
  const submittedAt = (existing && existing.submitted_at) || row.submitted_at || new Date().toISOString();
  importAgentRows([{ ...row, submitted_at: submittedAt, source: 'ai-daily' }], { jobsFile: file });
  return loadSubmissions(file).find((item) => canonicalUrl(item.url) === canonicalUrl(row.url));
}

function appendAgentNote(note, kind, file = JOBS_FILE) {
  if (require('./store/mode').isSupabase()) {
    if (!note || !note.id) throw new Error('id required');
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().recordIncident(note, kind);
  }
  const key = kind === 'blocker' ? 'blockers' : 'bugs';
  const row = {
    ...(note || {}),
    format: key === 'blockers' ? 'SITE-BLOCK' : 'JM-BUG',
  };
  if (row.id) row.id = String(row.id);
  if (!noteKey(row)) throw new Error('id required');
  const text = appendRootList(readJobsText(file), key, [row]);
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  clearSubmissionCache();
  return row;
}

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function applyRemoteLedger(text, jobsFile = JOBS_FILE) {
  const remoteDoc = loadDoc(text) || {};
  const result = importAgentRows(parseRows(text), {
    jobsFile,
    bugs: remoteDoc.bugs,
    blockers: remoteDoc.blockers,
  });
  return { ok: true, ...result };
}

function showLedger(root) {
  return execFileSync('git', ['show', `origin/${BRANCH}:${LEDGER_GIT_PATH}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function syncFromOrigin(jobsFile = JOBS_FILE) {
  const root = repoRoot();
  if (!root) return { ok: false, error: 'no-repo' };
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', BRANCH], {
      cwd: root,
      stdio: 'ignore',
      timeout: 30000,
    });
  } catch {
    return { ok: false, error: 'fetch-failed' };
  }
  try {
    return applyRemoteLedger(showLedger(root), jobsFile);
  } catch {
    return { ok: false, error: 'no-ledger-on-branch' };
  }
}

function syncFromOriginAsync(jobsFile = JOBS_FILE) {
  return new Promise((resolve) => {
    const root = repoRoot();
    if (!root) return resolve({ ok: false, error: 'no-repo' });
    execFile('git', ['fetch', '--quiet', 'origin', BRANCH], { cwd: root, timeout: 30000 }, (fetchErr) => {
      if (fetchErr) return resolve({ ok: false, error: 'fetch-failed' });
      execFile(
        'git',
        ['show', `origin/${BRANCH}:${LEDGER_GIT_PATH}`],
        { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
        (showErr, text) => {
          if (showErr) return resolve({ ok: false, error: 'no-ledger-on-branch' });
          try {
            resolve(applyRemoteLedger(text, jobsFile));
          } catch (err) {
            resolve({ ok: false, error: String(err.message || err) });
          }
        }
      );
    });
  });
}

const LEDGER_FILE = path.join(__dirname, '..', 'knowledge', 'ai-submissions.yaml');
const GIT_PATH = LEDGER_GIT_PATH;

function submissionByUrl(url) {
  const key = canonicalUrl(url);
  if (!key) return null;
  return (
    loadSubmissions().find((row) => row.url === url || canonicalUrl(row.url) === key) || null
  );
}

function unionSubmissions(local, remote) {
  const byUrl = new Map();
  for (const row of remote || []) {
    if (row && row.url) byUrl.set(row.url, normalizeRow(row));
  }
  for (const row of local || []) {
    if (!row || !row.url) continue;
    if (!byUrl.has(row.url)) byUrl.set(row.url, normalizeRow(row));
  }
  return [...byUrl.values()];
}

function effectiveStatus(url, localStatus, submissions) {
  const local = localStatus || 'open';
  if (local !== 'open') return local;
  const list = submissions || loadSubmissions();
  const key = canonicalUrl(url);
  const agent = list.some((row) => row && (row.url === url || (key && canonicalUrl(row.url) === key)));
  return agent ? 'submitted' : local;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function mergeJobEntries(localEntries, submissions) {
  const seen = new Set((localEntries || []).map((entry) => entry.url));
  const extra = [];
  for (const row of submissions || []) {
    if (!row.url || seen.has(row.url)) continue;
    seen.add(row.url);
    extra.push({
      id: row.id || agentId(row.url),
      name: row.company || row.title || 'Application',
      company: row.company || '',
      title: row.title || '',
      url: row.url,
      linkedin: row.linkedin || '',
      posting: row.posting || row.linkedin || '',
      logo: logoForCompany(row.company, row.url),
      hostname: hostnameOf(row.url),
      salary: row.salary || '',
      yoe: row.yoe || '',
      level: row.level || '',
      industries: [],
      skills: [],
      notes: 'AI daily apply',
      location: row.location || '',
      submitted_at: row.submitted_at || '',
      ai: true,
      agent: true,
    });
  }
  return (localEntries || []).concat(extra);
}

function saveSubmissions(rows, file = JOBS_FILE) {
  importAgentRows(rows, { jobsFile: file });
  return loadSubmissions(file);
}

module.exports = {
  JOBS_FILE,
  LEDGER_FILE,
  LEDGER_GIT_PATH,
  GIT_PATH,
  BRANCH,
  agentId,
  aiId: agentId,
  loadSubmissions,
  saveSubmissions,
  submissionByUrl,
  recordSubmission,
  unionSubmissions,
  effectiveStatus,
  mergeJobEntries,
  importAgentRows,
  appendListedJobs,
  appendAgentNote,
  applyRemoteLedger,
  syncFromOrigin,
  syncFromOriginAsync,
};
