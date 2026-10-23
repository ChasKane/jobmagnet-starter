const { test } = require('node:test');
const assert = require('node:assert/strict');
const tabs = require('./chat-tabs');

test('chatTabLabel keeps short company names and skips The', () => {
  assert.equal(tabs.chatTabLabel('The Home Depot'), 'Home');
  assert.equal(tabs.chatTabLabel('Meta'), 'Meta');
  assert.equal(tabs.chatTabLabel('JPMorgan Chase'), 'JPMorgan');
  assert.equal(tabs.chatTabLabel('International Business'), 'Internat');
  assert.equal(tabs.chatTabLabel('', { ingest: true }), 'Ingest');
});

test('ensureTab inserts behind MRU without changing the active chat', () => {
  let ui = tabs.ensureTab(tabs.emptyUi(), 'https://a.example/apply');
  assert.deepEqual(ui.mru, ['https://a.example/apply']);
  assert.equal(ui.active, tabs.INGEST_KEY);
  ui = tabs.selectTab(ui, 'https://a.example/apply');
  ui = tabs.ensureTab(ui, 'https://b.example/apply');
  assert.deepEqual(ui.mru, ['https://a.example/apply', 'https://b.example/apply']);
  assert.equal(ui.active, 'https://a.example/apply');
});

test('bumpTab on send makes that job current; ingest stays pinned', () => {
  let ui = tabs.ensureTab(tabs.emptyUi(), 'https://a.example/apply');
  ui = tabs.ensureTab(ui, 'https://b.example/apply');
  ui = tabs.bumpTab(ui, 'https://b.example/apply');
  assert.equal(ui.active, 'https://b.example/apply');
  assert.equal(ui.mru[0], 'https://b.example/apply');
  ui = tabs.bumpTab(ui, tabs.INGEST_KEY);
  assert.equal(ui.active, tabs.INGEST_KEY);
  assert.equal(ui.mru[0], 'https://b.example/apply');
});

test('packSubtabs pins Ingest and hides the page rail only for ingest', () => {
  const ui = {
    mru: ['https://a.example', 'https://b.example', 'https://c.example'],
    active: 'https://a.example',
  };
  const right = tabs.packSubtabs({ ...ui, handedness: 'right', jobFit: 2, labels: { 'https://a.example': 'Acme' } });
  assert.equal(right.moreSide, 'left');
  assert.deepEqual(
    right.pills.map((p) => p.key),
    ['https://b.example', 'https://a.example', tabs.INGEST_KEY]
  );
  assert.equal(right.pageRail, true);
  assert.deepEqual(right.overflow, ['https://c.example']);
  assert.equal(right.seeAll, false);

  const left = tabs.packSubtabs({ ...ui, handedness: 'left', jobFit: 2 });
  assert.equal(left.moreSide, 'right');
  assert.deepEqual(
    left.pills.map((p) => p.key),
    [tabs.INGEST_KEY, 'https://a.example', 'https://b.example']
  );

  const ingest = tabs.packSubtabs({ ...ui, active: tabs.INGEST_KEY, jobFit: 2 });
  assert.equal(ingest.pageRail, false);
});

test('pack and ensure skip mail and hunt keys', () => {
  const ui = tabs.normalizeUi({
    mru: ['__mail__', '__hunt__', 'https://ok.example'],
    active: '__mail__',
  });
  assert.deepEqual(ui.mru, ['https://ok.example']);
  assert.equal(ui.active, tabs.INGEST_KEY);
  assert.deepEqual(tabs.ensureTab(ui, '__hunt__').mru, ['https://ok.example']);
  const packed = tabs.packSubtabs({ mru: ['__mail__', 'https://ok.example'], jobFit: 3 });
  assert.deepEqual(
    packed.pills.filter((p) => p.kind === 'job').map((p) => p.key),
    ['https://ok.example']
  );
});

test('seeAll appears after the overflow cap', () => {
  const mru = Array.from({ length: 12 }, (_, i) => `https://j${i}.example`);
  const packed = tabs.packSubtabs({ mru, jobFit: 2, overflowMax: 8 });
  assert.equal(packed.overflow.length, 8);
  assert.equal(packed.seeAll, true);
});

test('pageTabs follow handedness; page rail is job-only', () => {
  assert.deepEqual(tabs.pageTabs('right'), ['jd', 'debug', 'chat']);
  assert.deepEqual(tabs.pageTabs('left'), ['chat', 'debug', 'jd']);
  assert.equal(tabs.pageRailVisible(tabs.INGEST_KEY), false);
  assert.equal(tabs.pageRailVisible('https://ok.example'), true);
  assert.equal(tabs.asPageSubtab('review'), 'debug');
});
