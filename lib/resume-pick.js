const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const FILE = path.join(__dirname, '..', 'knowledge', 'resumes.yaml');

function resolvePath(rel) {
  return path.resolve(path.dirname(FILE), rel);
}

function fromYaml() {
  const doc = yaml.load(fs.readFileSync(FILE, 'utf8')) || {};
  return Array.isArray(doc.resumes) ? doc.resumes : [];
}

let resumeCache = { at: 0, rows: null };
let resumeFlight = null;
let onResumes = null;

function loadResumes() {
  const now = Date.now();
  if (resumeCache.rows && now - resumeCache.at < 15000) return resumeCache.rows;
  const local = fromYaml().map((r) => ({ ...r, abs: resolvePath(r.path) }));
  if (!resumeFlight) {
    resumeFlight = (async () => {
      try {
        const persist = require('../packages/persist');
        persist.open();
        const api = persist.nodeStore();
        const stored = typeof api.listResumesAsync === 'function' ? await api.listResumesAsync() : api.listResumes();
        if (stored && stored.length) {
          resumeCache = {
            at: Date.now(),
            rows: stored.map((r) => ({
              id: r.id,
              label: r.label,
              path: r.relPath,
              match: r.match || [],
              abs: r.abs,
            })),
          };
          if (onResumes) onResumes();
          return resumeCache.rows;
        }
      } catch (_) {}
      resumeCache = { at: Date.now(), rows: local };
      return local;
    })().finally(() => {
      resumeFlight = null;
    });
  }
  return resumeCache.rows || local;
}

function pickResume(job, overrideId) {
  try {
    const persist = require('../packages/persist');
    persist.open();
    const hit = persist.nodeStore().pickResume(job, overrideId);
    if (hit) return hit;
  } catch (_) {}
  const list = loadResumes();
  if (overrideId) {
    const hit = list.find((r) => r.id === overrideId);
    if (hit) return { ...hit, abs: hit.abs || resolvePath(hit.path) };
  }
  const hay = [job.title, job.level, job.name].filter(Boolean).join(' ');
  for (const row of list) {
    const pats = Array.isArray(row.match) ? row.match : [];
    if (!pats.length) continue;
    if (pats.some((p) => new RegExp(p, 'i').test(hay))) {
      return { ...row, abs: row.abs || resolvePath(row.path) };
    }
  }
  const def = list.find((r) => r.id === 'default') || list[0];
  return def ? { ...def, abs: def.abs || resolvePath(def.path) } : null;
}

module.exports = { loadResumes, pickResume, resolvePath, watchResumes };

function watchResumes(fn) {
  onResumes = fn;
}
