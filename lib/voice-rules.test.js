const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `magnet-voice-${process.pid}.sqlite`);
process.env.MAGNET_DB = dbFile;
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-v-${process.pid}`);
process.env.MAGNET_VOICE_FILE = path.join(os.tmpdir(), `magnet-voice-${process.pid}.md`);

const store = require('./store');
const graph = require('./graph');
const { hasProperNoun, isEligibleFinal } = require('./voice-rules');
const { saveUserVoice, revertVoice, compactFromRows, acceptPending } = require('./voice-compact');
const { saveDebriefVoice } = require('./voice-debrief');

function reset() {
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  store.close();
  store.open(dbFile);
}

test('compact rejects proper nouns in rule text detector', () => {
  assert.equal(hasProperNoun('Prefer Lupe for pride questions'), true);
  assert.equal(hasProperNoun('Do not open with a career tour.'), false);
});

test('voice save / compact / revert kinds', () => {
  reset();
  const first = saveUserVoice('Be specific. No career tour.');
  assert.equal(first.kind, 'user');
  graph.upsertPendingRule('no_rule_of_three', 'Do not force a tidy rule-of-three or parallel stack. Uneven length is correct.');
  const compact = acceptPending();
  assert.equal(compact.kind, 'compact');
  assert.ok(compact.parent_id === first.id);
  const reverted = revertVoice(first.id);
  assert.equal(reverted.kind, 'revert');
  assert.match(reverted.text, /Be specific/);
  const hist = graph.voiceHistory();
  assert.ok(hist.some((h) => h.kind === 'user'));
  assert.ok(hist.some((h) => h.kind === 'compact'));
  assert.ok(hist.some((h) => h.kind === 'revert'));
  const debrief = saveDebriefVoice([{ text: 'Prefer a short, specific answer over a long résumé-shaped paragraph.' }]);
  assert.equal(debrief.row.kind, 'debrief');
  assert.ok(graph.voiceHistory().some((h) => h.kind === 'debrief'));
});

test('magnet rows are not eligible; unique rules propose', async () => {
  reset();
  assert.equal(isEligibleFinal({ origin: 'magnet', final: 'x'.repeat(100), label: 'why' }), false);
  assert.equal(isEligibleFinal({ origin: 'rewrite', final: 'x'.repeat(100), label: 'why this role' }), true);
  const out = await compactFromRows([
    { origin: 'rewrite', final: 'Please stop the career tour and the rule of three in these drafts going forward.', llm_draft: 'tour', label: 'Why us' },
    { origin: 'applicant', final: 'Cut the tour. Ownership bounds matter when I did not own experiment readouts.', label: 'Why us' },
    { origin: 'edit', final: 'Uneven length is correct. Quote the JD phrasing instead of generic enthusiasm.', label: 'Cover letter' },
  ]);
  assert.equal(out.proposed, false);
  assert.equal(out.pending.length, 0);
});
