const { filterBucket } = require('./jobs');

function hasAutofillRun(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.autofill_ran || rec.lastAutofillAt) return true;
  const events = Array.isArray(rec.events) ? rec.events : [];
  return events.some((e) => e && !e.deleted && (e.type === 'autofill' || e.type === 'autofill_ran'));
}

function jobLooksFilled(rec, fields) {
  if (rec && Array.isArray(rec.essays) && rec.essays.length) return true;
  if (rec && Number(rec.filled_count) > 0) return true;
  const list = Array.isArray(fields) ? fields : [];
  return list.some((f) => {
    const v = f && (f.value != null ? f.value : f.current);
    if (Array.isArray(v)) return v.length > 0;
    return String(v ?? '').trim() !== '';
  });
}

function jobIsOpen(job, rec) {
  const status = (job && (job.bucket || job.status)) || (rec && rec.status) || 'open';
  return filterBucket(status) === 'open';
}

function nextAutofillJob(jobs, opts = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const afterId = opts.afterId;
  const getProcess = typeof opts.getProcess === 'function' ? opts.getProcess : null;
  let i = 0;
  if (afterId) {
    const idx = list.findIndex((j) => j && (j.id === afterId || j.url === afterId));
    if (idx >= 0) i = idx + 1;
  }
  for (; i < list.length; i += 1) {
    const job = list[i];
    if (!job) continue;
    const rec = getProcess ? getProcess(job.url || job.id) : job;
    if (!jobIsOpen(job, rec)) continue;
    if (hasAutofillRun(rec) || hasAutofillRun(job)) continue;
    if (jobLooksFilled(rec, opts.fieldsFor && opts.fieldsFor(job))) continue;
    return job;
  }
  return null;
}

function asQueueN(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(50, Math.round(n)));
}

module.exports = {
  hasAutofillRun,
  jobLooksFilled,
  jobIsOpen,
  nextAutofillJob,
  asQueueN,
};
