/** Aggregate applications, scanned mail, and essays for the insights dashboard. */

const { classifyRejection } = require('./mail/classify-rejection');

const RANKS = [
  { id: 'intern', label: 'Intern' },
  { id: 'junior', label: 'Junior' },
  { id: 'mid', label: 'Mid' },
  { id: 'senior', label: 'Senior' },
  { id: 'lead', label: 'Lead' },
  { id: 'staff', label: 'Staff' },
  { id: 'principal', label: 'Principal' },
];

const RANK_IDS = new Set(RANKS.map((rank) => rank.id));

const LEVEL_EXACT = {
  intern: 'intern',
  junior: 'junior',
  entry: 'junior',
  jr: 'junior',
  mid: 'mid',
  'mid-level': 'mid',
  intermediate: 'mid',
  senior: 'senior',
  sr: 'senior',
  lead: 'lead',
  staff: 'staff',
  principal: 'principal',
  distinguished: 'principal',
  fellow: 'principal',
};

const TITLE_RULES = [
  ['principal', /\b(principal|distinguished|fellow)\b/i],
  ['staff', /\bstaff\b/i],
  ['lead', /\blead\b/i],
  ['senior', /\b(senior|sr\.?)\b/i],
  ['mid', /\b(mid(?:-?level)?|intermediate)\b/i],
  ['junior', /\b(junior|jr\.?|entry|associate|new grad)\b/i],
  ['intern', /\binterns?\b/i],
];

const METRICS = [
  { key: 'submissions', label: 'Submissions', kind: 'count', color: '#6ea8fe' },
  { key: 'received', label: 'Confirmations', kind: 'count', color: '#34d399' },
  { key: 'reject', label: 'Rejections', kind: 'count', color: '#f87171' },
  { key: 'interview', label: 'Interviews', kind: 'count', color: '#fbbf24' },
  { key: 'assessment', label: 'Assessments', kind: 'count', color: '#c084fc' },
  { key: 'offer', label: 'Offers', kind: 'count', color: '#4ade80' },
  { key: 'other', label: 'Other recruiting', kind: 'count', color: '#94a3b8' },
  { key: 'essays', label: 'Essays', kind: 'count', color: '#93c5fd' },
  { key: 'words', label: 'Essay words', kind: 'mean', color: '#f9a8d4' },
  { key: 'rewrite', label: 'Rewrite share', kind: 'ratio', color: '#fb923c' },
  { key: 'overlap', label: 'Draft overlap', kind: 'mean', color: '#a5b4fc' },
];

const METRIC_BY_KEY = new Map(METRICS.map((metric) => [metric.key, metric]));
const STYLE_COLORS = ['#38bdf8', '#f472b6', '#a3e635', '#fbbf24', '#c084fc', '#fb7185'];
const SUBMITTED = new Set(['submitted', 'rejected', 'passed', 'interviewing', 'offer', 'withdrawn']);
const GRAINS = new Set(['day', 'week', 'month']);

const { renderChart } = require('./insights-chart');

function rankOf(job) {
  const levelKey = String((job && job.level) || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
  if (LEVEL_EXACT[levelKey]) return LEVEL_EXACT[levelKey];
  const blob = `${(job && job.level) || ''} ${(job && job.title) || ''}`;
  for (const [rank, re] of TITLE_RULES) {
    if (re.test(blob)) return rank;
  }
  return '';
}

function dayOf(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  const prefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (prefix) return prefix[1];
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}

function bucketKey(value, grain) {
  const day = dayOf(value);
  if (!day) return '';
  if (grain === 'month') return day.slice(0, 7);
  if (grain === 'day') return day;
  const utc = new Date(`${day}T00:00:00Z`);
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - weekday + 1);
  return utc.toISOString().slice(0, 10);
}

function nextBucket(key, grain) {
  if (grain === 'month') {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  const utc = new Date(`${key}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + (grain === 'week' ? 7 : 1));
  return utc.toISOString().slice(0, 10);
}

function bucketSpan(key, grain) {
  if (grain === 'month') {
    const [year, month] = key.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return [`${key}-01`, last];
  }
  if (grain === 'week') {
    const utc = new Date(`${key}T00:00:00Z`);
    utc.setUTCDate(utc.getUTCDate() + 6);
    return [key, utc.toISOString().slice(0, 10)];
  }
  return [key, key];
}

function fillAxis(keys, grain) {
  const sorted = [...new Set(keys)].filter(Boolean).sort();
  if (!sorted.length) return [];
  const out = [];
  let cursor = sorted[0];
  const end = sorted[sorted.length - 1];
  let guard = 0;
  while (cursor <= end && guard < 500) {
    out.push(cursor);
    cursor = nextBucket(cursor, grain);
    guard += 1;
  }
  return out.length > 400 ? out.slice(-400) : out;
}

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function editClass(essay) {
  const text = String((essay && (essay.final || essay.text)) || '').trim();
  const draft = String((essay && (essay.draft || essay.llm_draft)) || '').trim();
  let overlap = essay && essay.overlap;
  if (overlap === '' || overlap == null || Number.isNaN(Number(overlap))) overlap = null;
  else overlap = Number(overlap);
  const unchanged =
    essay && (essay.unchanged === true || essay.unchanged === 1 || essay.unchanged === 'true' || essay.unchanged === '1');
  if (unchanged || (draft && text && draft === text)) {
    return { edit: 'kept', overlap: overlap == null ? 1 : overlap };
  }
  if (overlap != null && overlap >= 0.9) return { edit: 'kept', overlap };
  if (overlap != null && overlap >= 0.45) return { edit: 'light', overlap };
  return { edit: 'rewrite', overlap };
}

function classifyMail(row) {
  const src = row && typeof row === 'object' ? row : {};
  const verdict = String(src.verdict || '');
  const reason = String(src.reason || '');
  if (verdict === 'noise' || reason === 'marketing' || reason === 'unrelated') return 'noise';
  if (verdict === 'reject' || reason === 'template') return 'reject';
  if (verdict === 'received' || reason === 'received') return 'received';
  if (reason === 'interview' || reason === 'interviewing') return 'interview';
  if (reason === 'assessment') return 'assessment';
  if (reason === 'offer') return 'offer';
  if (!reason && (verdict === 'not_reject' || verdict === 'unsure' || !verdict) && (src.subject || src.from)) {
    const cls = classifyRejection({ from: src.from || '', subject: src.subject || '', text: src.text || src.subject || '' });
    if (cls.verdict === 'noise') return 'noise';
    if (cls.verdict === 'reject') return 'reject';
    if (cls.verdict === 'received' || cls.reason === 'received') return 'received';
    if (cls.reason === 'interview') return 'interview';
    if (cls.reason === 'assessment') return 'assessment';
  }
  if (!verdict && !reason) return 'noise';
  return 'other';
}

function normalizeJob(raw) {
  const job = raw && typeof raw === 'object' ? raw : {};
  const title = String(job.title || '');
  const level = String(job.level || '');
  return {
    url: String(job.url || ''),
    title,
    company: String(job.company || job.name || ''),
    level,
    rank: rankOf({ level, title }),
    status: String(job.status || 'open'),
    submitted_at: job.submitted_at || job.submittedAt ? String(job.submitted_at || job.submittedAt) : '',
  };
}

function normalizeMail(raw) {
  const row = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(row.id || ''),
    date: String(row.date || row.ts || ''),
    matched_url: row.matched_url ? String(row.matched_url) : '',
    outcome: classifyMail(row),
  };
}

function normalizeEssay(raw) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const text = String(row.final || row.text || row.llm_draft || '').trim();
  if (!text) return null;
  const edit = editClass({ ...row, final: text });
  return {
    url: String(row.url || ''),
    ts: String(row.ts || ''),
    words: wordCount(text),
    overlap: edit.overlap,
    edit: edit.edit,
  };
}

function isSubmission(job) {
  if (job.submitted_at) return true;
  return SUBMITTED.has(job.status);
}

function passesJob(job, config) {
  const title = String(config.title || '').trim().toLowerCase();
  if (title && !job.title.toLowerCase().includes(title)) return false;
  if (config.ranks.length && !config.ranks.includes(job.rank)) return false;
  return true;
}

function defaultCharts() {
  return [
    { id: 'submissions', title: 'Submissions', metrics: ['submissions'] },
    { id: 'mail', title: 'Email scans', metrics: ['received', 'reject', 'interview', 'assessment'] },
    { id: 'essay-style', title: 'Essay style', metrics: ['words', 'rewrite'] },
  ];
}

function cleanId(value, fallback) {
  const text = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{1,40}$/.test(text)) return text;
  return fallback;
}

function normalizeChart(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const metrics = [];
  const seen = new Set();
  for (const key of Array.isArray(src.metrics) ? src.metrics : []) {
    const name = String(key || '');
    if (!METRIC_BY_KEY.has(name) || seen.has(name)) continue;
    seen.add(name);
    metrics.push(name);
  }
  if (!metrics.length) return null;
  return {
    id: cleanId(src.id, `chart-${index + 1}`),
    title: String(src.title || '').trim().slice(0, 80),
    metrics,
  };
}

function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeStyle(raw, seen) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const name = String(src.name || '').trim().slice(0, 80);
  const start = String(src.start || '').slice(0, 10);
  if (!name || !validDay(start)) return null;
  let end = src.end ? String(src.end).slice(0, 10) : '';
  if (end && (!validDay(end) || end < start)) end = '';
  const ranks = [...new Set((Array.isArray(src.ranks) ? src.ranks : []).map(String))].filter((rank) => RANK_IDS.has(rank));
  let id = cleanId(src.id, '');
  if (!id || seen.has(id)) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'style';
    id = `${slug}-${start.replace(/-/g, '')}`;
    let n = 2;
    while (seen.has(id)) {
      id = `${slug}-${start.replace(/-/g, '')}-${n}`;
      n += 1;
    }
  }
  seen.add(id);
  return {
    id,
    name,
    notes: String(src.notes || '').trim().slice(0, 500),
    start,
    end,
    title: String(src.title || '').trim().slice(0, 80),
    ranks,
  };
}

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const grain = GRAINS.has(src.grain) ? src.grain : 'week';
  const ranks = [...new Set((Array.isArray(src.ranks) ? src.ranks : []).map(String))].filter((rank) => RANK_IDS.has(rank));
  const title = String(src.title || '').slice(0, 120);
  const charts = Array.isArray(src.charts)
    ? src.charts.map(normalizeChart).filter(Boolean).slice(0, 8)
    : defaultCharts();
  const seen = new Set();
  const styles = [];
  for (const row of Array.isArray(src.styles) ? src.styles : []) {
    const style = normalizeStyle(row, seen);
    if (style) styles.push(style);
    if (styles.length >= 24) break;
  }
  return { grain, title, ranks, charts, styles };
}

function styleMatchesJob(style, job) {
  if (style.title && !String(job.title || '').toLowerCase().includes(style.title.toLowerCase())) return false;
  if (style.ranks.length && !style.ranks.includes(job.rank || '')) return false;
  return true;
}

function styleCoversDay(style, day) {
  if (!day || day < style.start) return false;
  if (style.end && day > style.end) return false;
  return true;
}

function activeStyle(styles, day, job) {
  let best = null;
  for (const style of styles) {
    if (!styleCoversDay(style, day)) continue;
    if (job && !styleMatchesJob(style, job)) continue;
    if (!best || style.start > best.start || (style.start === best.start && style.id > best.id)) best = style;
  }
  return best;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(part, total) {
  if (!total) return null;
  return part / total;
}

function emptyCohort(style) {
  return {
    id: style.id,
    name: style.name,
    notes: style.notes,
    start: style.start,
    end: style.end,
    color: style.color,
    submissions: 0,
    confirmed: 0,
    rejected: 0,
    interviews: 0,
    assessments: 0,
    confirmRate: null,
    rejectRate: null,
    interviewRate: null,
    essays: 0,
    meanWords: null,
    rewriteShare: null,
    meanOverlap: null,
    _words: [],
    _rewrites: [],
    _overlaps: [],
    _urls: new Set(),
    _confirmed: new Set(),
    _rejected: new Set(),
    _interviews: new Set(),
    _assessments: new Set(),
  };
}

function finishCohort(row) {
  row.meanWords = mean(row._words);
  row.rewriteShare = row._rewrites.length ? mean(row._rewrites) : null;
  row.meanOverlap = mean(row._overlaps);
  row.confirmRate = rate(row.confirmed, row.submissions);
  row.rejectRate = rate(row.rejected, row.submissions);
  row.interviewRate = rate(row.interviews, row.submissions);
  delete row._words;
  delete row._rewrites;
  delete row._overlaps;
  delete row._urls;
  delete row._confirmed;
  delete row._rejected;
  delete row._interviews;
  delete row._assessments;
  return row;
}

function buildInsights(input, config) {
  const cfg = normalizeConfig(config);
  const source = input && typeof input === 'object' ? input : {};
  const jobs = (Array.isArray(source.jobs) ? source.jobs : []).map(normalizeJob).filter((job) => job.url);
  const mail = (Array.isArray(source.mail) ? source.mail : []).map(normalizeMail);
  const essays = (Array.isArray(source.essays) ? source.essays : []).map(normalizeEssay).filter(Boolean);
  const jobByUrl = new Map(jobs.map((job) => [job.url, job]));
  const filtered = jobs.filter((job) => passesJob(job, cfg));
  const filteredUrls = new Set(filtered.map((job) => job.url));
  const filterOn = Boolean(cfg.title.trim() || cfg.ranks.length);

  const submissions = [];
  let undated = 0;
  for (const job of filtered) {
    if (!isSubmission(job)) continue;
    if (!dayOf(job.submitted_at)) {
      undated += 1;
      continue;
    }
    submissions.push(job);
  }
  const submissionByUrl = new Map(submissions.map((job) => [job.url, job]));

  function mailVisible(row) {
    if (row.outcome === 'noise') return false;
    if (!filterOn) return true;
    return Boolean(row.matched_url && filteredUrls.has(row.matched_url));
  }

  function essayVisible(row) {
    if (!filterOn) return true;
    return Boolean(row.url && filteredUrls.has(row.url));
  }

  const visibleMail = mail.filter(mailVisible);
  const visibleEssays = essays.filter((row) => essayVisible(row) && dayOf(row.ts));
  const axis = fillAxis(
    [
      ...submissions.map((job) => bucketKey(job.submitted_at, cfg.grain)),
      ...visibleMail.map((row) => bucketKey(row.date, cfg.grain)),
      ...visibleEssays.map((row) => bucketKey(row.ts, cfg.grain)),
    ],
    cfg.grain
  );
  const axisSet = new Set(axis);

  const samples = new Map();
  function bump(key, bucket, value) {
    if (!bucket || !axisSet.has(bucket)) return;
    if (!samples.has(key)) samples.set(key, new Map());
    const bins = samples.get(key);
    if (!bins.has(bucket)) bins.set(bucket, []);
    bins.get(bucket).push(value);
  }

  for (const job of submissions) bump('submissions', bucketKey(job.submitted_at, cfg.grain), 1);
  for (const row of visibleMail) {
    if (!METRIC_BY_KEY.has(row.outcome)) continue;
    bump(row.outcome, bucketKey(row.date, cfg.grain), 1);
  }
  for (const row of visibleEssays) {
    const bucket = bucketKey(row.ts, cfg.grain);
    bump('essays', bucket, 1);
    bump('words', bucket, row.words);
    bump('rewrite', bucket, row.edit === 'rewrite' ? 1 : 0);
    if (row.overlap != null) bump('overlap', bucket, row.overlap);
  }

  const styles = cfg.styles.map((style, index) => ({
    ...style,
    color: STYLE_COLORS[index % STYLE_COLORS.length],
  }));
  const bands = styles
    .map((style) => {
      let startIndex = -1;
      let endIndex = -1;
      const end = style.end || '9999-12-31';
      axis.forEach((key, index) => {
        const [from, to] = bucketSpan(key, cfg.grain);
        if (from <= end && style.start <= to) {
          if (startIndex < 0) startIndex = index;
          endIndex = index;
        }
      });
      return { id: style.id, name: style.name, color: style.color, startIndex, endIndex };
    })
    .filter((band) => band.startIndex >= 0);

  function pointsFor(metric) {
    const bins = samples.get(metric.key) || new Map();
    return axis.map((tick) => {
      const values = bins.get(tick) || [];
      if (!values.length) return { t: tick, value: metric.kind === 'count' ? 0 : null };
      if (metric.kind === 'count') return { t: tick, value: values.length };
      return { t: tick, value: mean(values) };
    });
  }

  const charts = cfg.charts.map((chart) => {
    const series = chart.metrics.map((key) => {
      const metric = METRIC_BY_KEY.get(key);
      return { key, label: metric.label, kind: metric.kind, color: metric.color, points: pointsFor(metric) };
    });
    const title = chart.title || series.map((item) => item.label).join(' · ');
    return {
      id: chart.id,
      title,
      metrics: chart.metrics,
      series,
      svg: renderChart({ title, axis, series, bands, grain: cfg.grain }),
    };
  });

  const cohorts = new Map();
  for (const style of styles) cohorts.set(style.id, emptyCohort(style));
  const unassigned = emptyCohort({
    id: 'unassigned',
    name: 'No style',
    notes: '',
    start: '',
    end: '',
    color: '#8b93a7',
  });

  function cohortFor(day, job) {
    if (!styles.length) return null;
    const style = activeStyle(styles, day, job || { title: '', rank: '' });
    return style ? cohorts.get(style.id) : unassigned;
  }

  for (const job of submissions) {
    const row = cohortFor(dayOf(job.submitted_at), job);
    if (!row) continue;
    row.submissions += 1;
    row._urls.add(job.url);
  }

  for (const row of visibleMail) {
    const job = row.matched_url ? submissionByUrl.get(row.matched_url) : null;
    if (!job) continue;
    const cohort = cohortFor(dayOf(job.submitted_at), job);
    if (!cohort || !cohort._urls.has(job.url)) continue;
    if (row.outcome === 'received') cohort._confirmed.add(job.url);
    else if (row.outcome === 'reject') cohort._rejected.add(job.url);
    else if (row.outcome === 'interview') cohort._interviews.add(job.url);
    else if (row.outcome === 'assessment') cohort._assessments.add(job.url);
  }

  for (const essay of visibleEssays) {
    const job = essay.url ? jobByUrl.get(essay.url) : null;
    const cohort = cohortFor(dayOf(essay.ts), job || { title: '', rank: '' });
    if (!cohort) continue;
    cohort.essays += 1;
    cohort._words.push(essay.words);
    cohort._rewrites.push(essay.edit === 'rewrite' ? 1 : 0);
    if (essay.overlap != null) cohort._overlaps.push(essay.overlap);
  }

  for (const row of cohorts.values()) {
    row.confirmed = row._confirmed.size;
    row.rejected = row._rejected.size;
    row.interviews = row._interviews.size;
    row.assessments = row._assessments.size;
  }
  unassigned.confirmed = unassigned._confirmed.size;
  unassigned.rejected = unassigned._rejected.size;
  unassigned.interviews = unassigned._interviews.size;
  unassigned.assessments = unassigned._assessments.size;

  const comparison = [...cohorts.values()].map(finishCohort);
  const hasUnassigned =
    unassigned.submissions || unassigned.essays || unassigned.confirmed || unassigned.rejected || unassigned.interviews;
  if (styles.length && hasUnassigned) comparison.push(finishCohort(unassigned));

  let receivedMatched = 0;
  let receivedUnmatched = 0;
  let hiddenMail = 0;
  const confirmed = new Set();
  const rejected = new Set();
  const interviews = new Set();
  for (const row of mail) {
    if (row.outcome === 'noise') continue;
    const matched = row.matched_url && submissionByUrl.has(row.matched_url);
    if (row.outcome === 'received') {
      if (matched) receivedMatched += 1;
      else receivedUnmatched += 1;
    }
    if (!mailVisible(row)) {
      hiddenMail += 1;
      continue;
    }
    if (!matched) continue;
    if (row.outcome === 'received') confirmed.add(row.matched_url);
    else if (row.outcome === 'reject') rejected.add(row.matched_url);
    else if (row.outcome === 'interview') interviews.add(row.matched_url);
  }

  const wordValues = visibleEssays.map((row) => row.words);
  const rewriteValues = visibleEssays.map((row) => (row.edit === 'rewrite' ? 1 : 0));

  return {
    config: cfg,
    ranks: RANKS,
    metrics: METRICS.map(({ key, label, kind }) => ({ key, label, kind })),
    summary: {
      submissions: submissions.length,
      undated,
      receivedMatched,
      receivedUnmatched,
      confirmed: confirmed.size,
      rejected: rejected.size,
      interviews: interviews.size,
      hiddenMail: filterOn ? hiddenMail : 0,
      essays: visibleEssays.length,
      meanWords: mean(wordValues),
      rewriteShare: visibleEssays.length ? mean(rewriteValues) : null,
    },
    axis,
    grain: cfg.grain,
    bands,
    charts,
    comparison,
  };
}

module.exports = {
  RANKS,
  METRICS,
  rankOf,
  dayOf,
  bucketKey,
  classifyMail,
  editClass,
  normalizeConfig,
  activeStyle,
  buildInsights,
};
