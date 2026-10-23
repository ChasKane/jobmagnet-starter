const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.MAGNET_DB = path.join(os.tmpdir(), `magnet-tab-agent-${process.pid}.sqlite`);
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-tab-${process.pid}`);

const { jobSnapshot } = require('./tab-agent');

test('jobSnapshot is the 4-stage packet with full current, not slim talk', () => {
  const snap = jobSnapshot({
    instruction: 'how might I end this draft?',
    fields: [{ id: 'q1', label: 'Why us', current: 'JOKE_LINE\nPORTFOLIO_LINE' }],
    bodies: [{ id: 'card_a', employer: 'Peloton', claim: 'Page Builder', proof: 'Shipped it.' }],
    company: 'Prophet',
    title: 'Engineer',
    jd: { text: 'Build security tools' },
    voice: 'Be short.',
  });
  assert.match(snap, /Stage 1 Strategy/);
  assert.match(snap, /JOKE_LINE/);
  assert.match(snap, /PORTFOLIO_LINE/);
  assert.match(snap, /do not reply yet/i);
  assert.match(snap, /Do not emit JSON yet/);
  assert.doesNotMatch(snap, /Reply in prose/);
  assert.doesNotMatch(snap, /Mode: discuss/);
});
