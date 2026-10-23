#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const store = require('./store');
const graph = require('./graph');
const {
  seedTimelineFromProfile,
  compileUpdates,
  compileFinals,
  repairOrphanApplyEmployers,
  seedSkillYears,
  restoreVoiceFromFile,
} = require('./compile');
const { loadProfile, loadExperienceNotes } = require('./employment');
const { rankAnswer } = require('./answer-rank');
const { dump } = require('./store/export');
const { loadRichboi } = require('./essay-prompt');

const ANSWERS = path.join(__dirname, '..', 'knowledge', 'archive', 'answers.jsonl');

function loadFinals() {
  try {
    if (!fs.existsSync(ANSWERS)) return [];
    return fs
      .readFileSync(ANSWERS, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map((row) => ({ ...row, ...rankAnswer(row) }));
  } catch (_) {
    return [];
  }
}

async function migrate() {
  store.open();
  const profile = loadProfile();
  const stubs = seedTimelineFromProfile(profile);
  repairOrphanApplyEmployers(profile);
  const notes = loadExperienceNotes();
  const notePatches = await compileUpdates(
    notes.map((n) => ({ employer: n.employer, text: n.text })),
    { source: 'dump', allowUnquoted: true, userText: notes.map((n) => n.text).join('\n') }
  );
  const finals = loadFinals().filter((r) => r.origin === 'applicant' || r.origin === 'rewrite');
  const finalPatches = await compileFinals(finals, { source: 'final' });
  const skills = seedSkillYears();
  const voice = restoreVoiceFromFile(loadRichboi());
  const dest = dump();
  return {
    stubs: stubs.length,
    notePatches: notePatches.length,
    finalPatches: finalPatches.length,
    skills: skills && skills.kind,
    voice_id: voice && voice.id,
    export: dest,
  };
}

if (require.main === module) {
  migrate()
    .then((out) => {
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { migrate };
