(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.sidebarFilters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SORTS = [
    { value: 'updated', label: 'Updated' },
    { value: 'company', label: 'Company' },
    { value: 'title', label: 'Title' },
    { value: 'salary', label: 'Salary' },
    { value: 'yoe', label: 'YoE' },
    { value: 'level', label: 'Level' },
    { value: 'added', label: 'Added' },
  ];
  const SORT_VALUES = new Set(SORTS.map((s) => s.value));
  const STATUSES = new Set(['open', 'submitted', 'rejected', 'passed', 'all']);
  const DEFAULTS = {
    status: 'open',
    yoe: 'all',
    level: 'all',
    q: '',
    sort: 'updated',
  };
  const LEVEL_RANK = {
    intern: 0,
    junior: 1,
    entry: 1,
    mid: 2,
    'mid-level': 2,
    senior: 3,
    staff: 4,
    principal: 5,
    distinguished: 6,
    fellow: 7,
    lead: 3.5,
    manager: 4,
    director: 8,
  };

  function filterBucket(status) {
    if (!status || status === 'open') return 'open';
    if (status === 'rejected') return 'rejected';
    if (status === 'passed') return 'passed';
    return 'submitted';
  }

  function asChoice(value, allowed, fallback) {
    const v = String(value == null ? '' : value).trim();
    return allowed.has(v) ? v : fallback;
  }

  function normalize(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const yoe = src.yoe == null || src.yoe === '' ? 'all' : String(src.yoe);
    const level = src.level == null || src.level === '' ? 'all' : String(src.level);
    return {
      status: asChoice(src.status, STATUSES, DEFAULTS.status),
      yoe,
      level,
      q: String(src.q == null ? '' : src.q),
      sort: asChoice(src.sort, SORT_VALUES, DEFAULTS.sort),
    };
  }

  function lastUpdatedMs(job, rec) {
    const row = rec && typeof rec === 'object' ? rec : {};
    const src = job && typeof job === 'object' ? job : {};
    const times = [
      src.updatedAt,
      src.updated_at,
      row.updatedAt,
      row.updated_at,
      row.submitted_at,
      row.rejected_at,
      src.submitted_at,
      src.rejected_at,
    ];
    const events = Array.isArray(row.events) ? row.events : Array.isArray(src.events) ? src.events : [];
    for (const event of events) {
      if (event && event.at) times.push(event.at);
    }
    let max = 0;
    for (const value of times) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && ms > max) max = ms;
    }
    return max;
  }

  function updatedAt(job, rec) {
    const ms = lastUpdatedMs(job, rec);
    return ms ? new Date(ms).toISOString() : '';
  }

  function salaryRank(value) {
    const text = String(value || '');
    const ks = [...text.matchAll(/(\d+(?:\.\d+)?)\s*k\b/gi)].map((m) => parseFloat(m[1]) * 1000);
    if (ks.length) return Math.max(...ks);
    const nums = [...text.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})+|\d{4,7})\b/g)].map((m) => Number(String(m[1]).replace(/,/g, '')));
    if (nums.length) return Math.max(...nums);
    return -1;
  }

  function yoeRank(value) {
    const nums = String(value || '').match(/\d+/g);
    if (!nums) return -1;
    return Math.max(...nums.map(Number));
  }

  function levelRank(value) {
    const key = String(value || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-');
    if (key && Object.prototype.hasOwnProperty.call(LEVEL_RANK, key)) return LEVEL_RANK[key];
    const n = key.match(/(\d+)/);
    return n ? 10 + Number(n[1]) : -1;
  }

  function cmpStr(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  function compare(a, b, sort) {
    const left = a || {};
    const right = b || {};
    if (sort === 'company') {
      return cmpStr(left.company || left.name, right.company || right.name) || cmpStr(left.title, right.title);
    }
    if (sort === 'title') {
      return cmpStr(left.title, right.title) || cmpStr(left.company || left.name, right.company || right.name);
    }
    if (sort === 'salary') {
      return salaryRank(right.salary) - salaryRank(left.salary) || cmpStr(left.company || left.name, right.company || right.name);
    }
    if (sort === 'yoe') {
      return yoeRank(right.yoe) - yoeRank(left.yoe) || cmpStr(left.company || left.name, right.company || right.name);
    }
    if (sort === 'level') {
      return levelRank(right.level) - levelRank(left.level) || cmpStr(left.company || left.name, right.company || right.name);
    }
    if (sort === 'added') {
      const ai = Number.isFinite(Number(left.sortIndex)) ? Number(left.sortIndex) : 1e9;
      const bi = Number.isFinite(Number(right.sortIndex)) ? Number(right.sortIndex) : 1e9;
      return ai - bi || cmpStr(left.id, right.id);
    }
    return lastUpdatedMs(right) - lastUpdatedMs(left) || cmpStr(left.id, right.id);
  }

  function match(job, filters) {
    const f = normalize(filters);
    const row = job || {};
    const bucket = row.bucket || filterBucket(row.status);
    if (f.status !== 'all' && bucket !== f.status) return false;
    if (f.yoe !== 'all' && String(row.yoe || '') !== f.yoe) return false;
    if (f.level !== 'all' && String(row.level || '') !== f.level) return false;
    const q = f.q.trim().toLowerCase();
    if (q) {
      const hay = [
        row.name,
        row.company,
        row.title,
        row.salary,
        row.yoe,
        row.level,
        row.url,
        row.notes,
        ...(row.industries || []),
        ...(row.skills || []),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function apply(jobs, filters) {
    const f = normalize(filters);
    return (Array.isArray(jobs) ? jobs.slice() : []).filter((job) => match(job, f)).sort((a, b) => compare(a, b, f.sort));
  }

  return {
    SORTS,
    DEFAULTS,
    normalize,
    match,
    apply,
    compare,
    updatedAt,
    lastUpdatedMs,
    salaryRank,
    yoeRank,
    levelRank,
    filterBucket,
  };
});
