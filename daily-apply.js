#!/usr/bin/env node
const fs = require('fs');
const { acceptJobs } = require('./lib/daily-criteria');
const { loadJobsDoc } = require('./lib/jobs-file');
const { duplicateOf, indexJobs } = require('./lib/job-identity');
const {
  JOBS_FILE,
  recordSubmission,
  appendAgentNote,
  syncFromOrigin,
} = require('./lib/ai-submissions');

function opt(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'sync') {
    const result = syncFromOrigin();
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }
  if (cmd === 'urls') {
    const seen = new Set();
    let listed = [];
    if (require('./lib/store/mode').isSupabase()) {
      const persist = require('./packages/persist');
      persist.open();
      listed = persist.nodeStore().listJobs();
    } else listed = loadJobsDoc(JOBS_FILE).jobs || [];
    for (const job of listed) {
      if (job && job.url && !seen.has(job.url)) {
        seen.add(job.url);
        console.log(job.url);
      }
    }
    return;
  }
  if (cmd === 'bug' || cmd === 'blocker') {
    const raw = await readStdin();
    const note = JSON.parse(raw || '{}');
    console.log(JSON.stringify(appendAgentNote(note, cmd === 'blocker' ? 'blocker' : 'bug')));
    return;
  }
  if (cmd === 'record') {
    const url = opt('--url');
    const company = opt('--company');
    const { harvestViaControl, recordAnswers } = require('./lib/answer-log');
    const harvested = await harvestViaControl({ url, company, title: opt('--title') });
    if ((!harvested || !harvested.ok) && opt('--answers')) {
      try {
        const extra = JSON.parse(opt('--answers'));
        recordAnswers(Array.isArray(extra) ? extra : extra.fields || [], { url, company });
      } catch (err) {
        console.warn('answers:', err.message || err);
      }
    }
    const row = recordSubmission({
      url,
      company,
      title: opt('--title'),
      location: opt('--location'),
      posting: opt('--posting'),
      linkedin: opt('--linkedin'),
      salary: opt('--salary'),
      level: opt('--level'),
      yoe: opt('--yoe'),
    });
    console.log(JSON.stringify({ ...row, answers: harvested && harvested.count, essays: harvested && harvested.essays }));
    return;
  }
  if (cmd === 'essays' || cmd === 'essay-log') {
    const { optionsFromArgv, printEssays } = require('./lib/essay-browser');
    const opts = optionsFromArgv(process.argv.slice(3));
    if (!opts.limit) opts.limit = 20;
    console.log(printEssays(opts));
    return;
  }
  if (cmd === 'accept') {
    const raw = await readStdin();
    const jobs = JSON.parse(raw || '[]');
    let known = loadJobsDoc(JOBS_FILE).jobs || [];
    if (require('./lib/store/mode').isSupabase()) {
      const persist = require('./packages/persist');
      persist.open();
      known = persist.nodeStore().listJobs();
    }
    const index = indexJobs(known);
    const { accepted, rejected } = acceptJobs(jobs);
    const fresh = [];
    for (const job of accepted) {
      const dup = duplicateOf(job, index);
      if (dup) rejected.push({ ...job, reason: dup.reason });
      else fresh.push(job);
    }
    console.log(JSON.stringify({ accepted: fresh, rejected }, null, 2));
    return;
  }
  console.error(
    'node daily-apply.js sync|urls|accept|record|bug|blocker|essays --url <apply-url> --company <name> --title <title>'
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
