const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { load: loadProfile } = require('./profile-facts');

const NOTES_FILE = path.join(__dirname, '..', 'knowledge', 'experience-notes.yaml');

function notesFile() {
  return process.env.MAGNET_NOTES || NOTES_FILE;
}

function loadExperienceNotes() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().listExperienceNotes();
  }
  try {
    const doc = yaml.load(fs.readFileSync(notesFile(), 'utf8')) || {};
    return Array.isArray(doc.notes) ? doc.notes : [];
  } catch (_) {
    return [];
  }
}

function saveExperienceNotes(notes) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    persist.nodeStore().saveExperienceNotes(notes);
    return;
  }
  const dest = notesFile();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, yaml.dump({ version: 1, notes }, { lineWidth: 88, noRefs: true, sortingKeys: false }));
}

function matchEmployer(jobs, name) {
  const q = String(name || '')
    .trim()
    .toLowerCase();
  if (!q) return '';
  for (const job of jobs) {
    const employer = String(job.employer || '').trim();
    const hay = `${employer} ${job.title || ''} ${job.bullets || ''}`.toLowerCase();
    if (hay.includes(q) || q.includes(employer.toLowerCase())) return employer;
  }
  return String(name || '').trim();
}

async function applyExperienceUpdates(updates, ctx = {}) {
  const { compileUpdates } = require('./compile');
  const jobs = (loadProfile().employment || []).filter(Boolean);
  const rows = (Array.isArray(updates) ? updates : []).map((u) => ({
    ...u,
    employer: matchEmployer(jobs, (u && (u.employer || u.company)) || '') || (u && (u.employer || u.company)) || '',
  }));
  return compileUpdates(rows, ctx);
}

function formatEmploymentForPrompt() {
  const jobs = loadProfile().employment || [];
  if (!jobs.length) return '(none on file)';
  const blocks = jobs.map((job) => {
    const dates = [job.start, job.end || (job.current ? 'present' : '')].filter(Boolean).join(' – ');
    return [
      `${job.title || 'Role'} @ ${job.employer || ''} (${dates})${job.location ? ` · ${job.location}` : ''}`,
      String(job.bullets || '').trim() || '(no bullets yet)',
    ].join('\n');
  });
  return blocks.join('\n\n').slice(0, 6000);
}

const ADD_SCRIPT = `(() => {
  const buttons = [...document.querySelectorAll('button, a, [role="button"]')];
  const re = /add (another )?(position|job|employer|experience|education|school)/i;
  const btn = buttons.find((b) => re.test((b.innerText || b.getAttribute('aria-label') || '')));
  if (!btn) return { ok: false, reason: 'no-add' };
  btn.click();
  return { ok: true };
})()`;

const COUNT_ROWS_SCRIPT = `(() => {
  const blocks = document.querySelectorAll('[class*="experience"], [class*="employment"], [data-testid*="employment"]');
  return { count: blocks.length || 0 };
})()`;

function monthYear(iso) {
  if (!iso) return { month: '', year: '' };
  const [y, m] = String(iso).split('-');
  return { month: m || '', year: y || '' };
}

function employmentPlan() {
  const profile = loadProfile();
  const jobs = Array.isArray(profile.employment) ? profile.employment : [];
  const edu = Array.isArray(profile.education) ? profile.education : [];
  return {
    employment: jobs.map((row) => ({
      employer: row.employer,
      title: row.title,
      ...monthYear(row.start),
      start: row.start,
      end: row.end,
      current: Boolean(row.current),
      location: row.location || '',
      bullets: String(row.bullets || '').trim(),
    })),
    education: edu.map((row) => ({
      school: row.school,
      degree: row.degree,
      end: row.end,
      ...monthYear(row.end),
    })),
  };
}

module.exports = {
  ADD_SCRIPT,
  COUNT_ROWS_SCRIPT,
  employmentPlan,
  loadProfile,
  loadExperienceNotes,
  saveExperienceNotes,
  applyExperienceUpdates,
  formatEmploymentForPrompt,
};
